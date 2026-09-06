import Constants from 'expo-constants';

import { haversineKm } from '@/lib/geo-utils';

export type LngLat = [number, number];

export type RouteResult = {
  geometry: { type: 'LineString'; coordinates: [number, number][] };
  distanceM: number;
  durationS: number;
  /** `"ors"` = OpenRouteService (rues) ; `"estimate"` = vol d'oiseau. */
  source: 'ors' | 'estimate';
  /** Renseigné sur un repli `estimate` : pourquoi ORS n'a pas répondu. */
  error?: string;
};

/**
 * `api.openrouteservice.org` est déprécié depuis avril 2026 au profit de
 * `api.heigit.org` : quota rabaissé à 10 % le 27/08/2026, extinction le
 * 28/09/2026. On tape donc le nouvel hôte d'abord, l'ancien ne sert que de filet.
 */
export const ORS_ENDPOINTS = [
  'https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson',
  'https://api.openrouteservice.org/v2/directions/driving-car/geojson',
] as const;

/** Le service public accroche au réseau routier dans un rayon max de 350 m. */
const ORS_SNAP_RADIUS_M = 350;
const ROAD_DETOUR_FACTOR = 1.4;
export const DEFAULT_ESTIMATE_SPEED_KMH = 26;

/**
 * Clé lue depuis `.env.local` via `app.config.js` (`extra.orsApiKey`)
 * ou `EXPO_PUBLIC_ORS_API_KEY`. Convex peut aussi l'avoir (`ORS_API_KEY`).
 */
export function orsApiKey(): string {
  const extra = Constants.expoConfig?.extra as { orsApiKey?: string } | undefined;
  return process.env.EXPO_PUBLIC_ORS_API_KEY?.trim() || extra?.orsApiKey?.trim() || '';
}

export function estimateRoute(
  from: LngLat,
  to: LngLat,
  speedKmh: number = DEFAULT_ESTIMATE_SPEED_KMH,
  error?: string,
): RouteResult {
  const straightKm = haversineKm(from, to);
  const roadKm = straightKm * ROAD_DETOUR_FACTOR;
  const speed = speedKmh > 0 ? speedKmh : DEFAULT_ESTIMATE_SPEED_KMH;
  return {
    geometry: { type: 'LineString', coordinates: [from, to] },
    distanceM: Math.round(roadKm * 1000),
    durationS: Math.round((roadKm / speed) * 3600),
    source: 'estimate',
    error,
  };
}

export function isRouteResult(value: unknown): value is RouteResult {
  if (!value || typeof value !== 'object') return false;
  const data = value as RouteResult;
  return (
    Array.isArray(data.geometry?.coordinates) &&
    data.geometry.coordinates.length > 1 &&
    typeof data.distanceM === 'number' &&
    typeof data.durationS === 'number'
  );
}

type OrsGeoJson = {
  features?: Array<{
    geometry?: { type?: string; coordinates?: [number, number][] };
    properties?: { summary?: { distance?: number; duration?: number } };
  }>;
  error?: { code?: number; message?: string } | string;
};

function orsBody(from: LngLat, to: LngLat) {
  return JSON.stringify({
    coordinates: [from, to],
    instructions: false,
    geometry: true,
    geometry_simplify: false,
    elevation: false,
    // Sans ce paramètre ORS refuse un point GPS posé à côté d'une rue.
    radiuses: [ORS_SNAP_RADIUS_M, ORS_SNAP_RADIUS_M],
  });
}

function parseOrs(data: OrsGeoJson): RouteResult {
  const feat = data.features?.[0];
  const coords = feat?.geometry?.coordinates;
  const summary = feat?.properties?.summary;
  if (!coords || coords.length < 2 || summary?.distance == null || summary.duration == null) {
    const detail =
      typeof data.error === 'string' ? data.error : data.error?.message ?? 'réponse sans tracé';
    throw new Error(`ORS: ${detail}`);
  }
  return {
    geometry: { type: 'LineString', coordinates: coords },
    distanceM: summary.distance,
    durationS: summary.duration,
    source: 'ors',
  };
}

/**
 * Itinéraire voiture OpenRouteService (POST GeoJSON officiel), nouvel hôte
 * d'abord puis repli sur l'ancien tant qu'il vit.
 */
export async function fetchOrsRoute(
  from: LngLat,
  to: LngLat,
  key: string,
  opts: { signal?: AbortSignal } = {},
): Promise<RouteResult> {
  let lastError: Error | null = null;

  for (const url of ORS_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: key,
          'Content-Type': 'application/json',
          Accept: 'application/geo+json, application/json',
        },
        body: orsBody(from, to),
        signal: opts.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`ORS ${res.status} ${detail.slice(0, 180)}`);
      }

      return parseOrs((await res.json()) as OrsGeoJson);
    } catch (err) {
      if ((err as Error).name === 'AbortError' || opts.signal?.aborted) throw err;
      lastError = err as Error;
      console.warn(`[route] ${url} a échoué:`, (err as Error).message);
    }
  }

  throw lastError ?? new Error('ORS injoignable');
}

/**
 * Mémoire de session : un même couple (départ, arrivée) n'est demandé qu'une
 * fois à ORS. Protège des remontages d'écran, du hot reload et d'une même
 * destination re-sélectionnée. Clé au 1/10 000e de degré (~11 m).
 */
const routeCache = new Map<string, RouteResult>();
const ROUTE_CACHE_LIMIT = 50;

function cacheKey(from: LngLat, to: LngLat): string {
  const r = (n: number) => n.toFixed(4);
  return `${r(from[0])},${r(from[1])}>${r(to[0])},${r(to[1])}`;
}

function remember(key: string, route: RouteResult): RouteResult {
  if (routeCache.size >= ROUTE_CACHE_LIMIT) {
    const oldest = routeCache.keys().next().value;
    if (oldest !== undefined) routeCache.delete(oldest);
  }
  routeCache.set(key, route);
  return route;
}

/** Vide le cache d'itinéraires (tests, ou changement de clé ORS). */
export function clearRouteCache() {
  routeCache.clear();
}

export async function fetchRoute(
  from: LngLat,
  to: LngLat,
  opts: { signal?: AbortSignal } = {},
): Promise<RouteResult> {
  const key = orsApiKey();
  if (!key) return estimateRoute(from, to, DEFAULT_ESTIMATE_SPEED_KMH, 'Clé ORS absente côté app');

  const id = cacheKey(from, to);
  const cached = routeCache.get(id);
  if (cached) return cached;

  console.log(`[route] appel ORS ${id}`);
  return remember(id, await fetchOrsRoute(from, to, key, opts));
}
