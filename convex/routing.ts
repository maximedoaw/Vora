import { v } from "convex/values";
import { action } from "./_generated/server";

type LngLat = [number, number];

type RouteResult = {
  geometry: { type: "LineString"; coordinates: [number, number][] };
  distanceM: number;
  durationS: number;
  source: "ors" | "estimate";
  error?: string;
};

/**
 * `api.openrouteservice.org` est déprécié depuis avril 2026 au profit de
 * `api.heigit.org` (quota à 10 % depuis le 27/08/2026, arrêt le 28/09/2026).
 */
const ORS_ENDPOINTS = [
  "https://api.heigit.org/openrouteservice/v2/directions/driving-car/geojson",
  "https://api.openrouteservice.org/v2/directions/driving-car/geojson",
];

const ORS_TIMEOUT_MS = 15000;
/** Rayon max d'accrochage au réseau routier sur l'API publique. */
const ORS_SNAP_RADIUS_M = 350;
const ROAD_DETOUR_FACTOR = 1.4;
const DEFAULT_SPEED_KMH = 26;
const R_EARTH_KM = 6371;

function haversineKm(a: LngLat, b: LngLat): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function estimateRoute(from: LngLat, to: LngLat, error?: string): RouteResult {
  const roadKm = haversineKm(from, to) * ROAD_DETOUR_FACTOR;
  return {
    geometry: { type: "LineString", coordinates: [from, to] },
    distanceM: Math.round(roadKm * 1000),
    durationS: Math.round((roadKm / DEFAULT_SPEED_KMH) * 3600),
    source: "estimate",
    error,
  };
}

function parsePair(value: number[]): LngLat | null {
  if (value.length !== 2) return null;
  const [lng, lat] = value;
  if (!Number.isFinite(lng) || !Number.isFinite(lat)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return [lng, lat];
}

async function requestOrs(url: string, key: string, from: LngLat, to: LngLat): Promise<RouteResult> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: key,
      "Content-Type": "application/json",
      Accept: "application/geo+json, application/json",
    },
    body: JSON.stringify({
      coordinates: [from, to],
      instructions: false,
      geometry: true,
      geometry_simplify: false,
      elevation: false,
      radiuses: [ORS_SNAP_RADIUS_M, ORS_SNAP_RADIUS_M],
    }),
    signal: AbortSignal.timeout(ORS_TIMEOUT_MS),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ORS ${res.status} ${detail.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number][] };
      properties?: { summary?: { distance?: number; duration?: number } };
    }>;
  };

  const feat = data.features?.[0];
  const coords = feat?.geometry?.coordinates;
  const summary = feat?.properties?.summary;
  if (!coords || coords.length < 2 || summary?.distance == null || summary.duration == null) {
    throw new Error("ORS: réponse sans tracé routier");
  }

  return {
    geometry: { type: "LineString", coordinates: coords },
    distanceM: summary.distance,
    durationS: summary.duration,
    source: "ors",
  };
}

/**
 * OpenRouteService POST `/v2/directions/driving-car/geojson`.
 * Clé : `ORS_API_KEY` dans le dashboard Convex (repli si l'app n'a pas la clé).
 */
export const getDirections = action({
  args: {
    from: v.array(v.number()),
    to: v.array(v.number()),
  },
  handler: async (_ctx, { from, to }): Promise<RouteResult> => {
    const origin = parsePair(from);
    const dest = parsePair(to);
    if (!origin || !dest) throw new Error("Coordonnées d'itinéraire invalides.");

    const key = process.env.ORS_API_KEY;
    if (!key) return estimateRoute(origin, dest, "ORS_API_KEY absente du déploiement Convex");

    let lastError = "ORS injoignable";
    for (const url of ORS_ENDPOINTS) {
      try {
        return await requestOrs(url, key, origin, dest);
      } catch (err) {
        lastError = (err as Error).message;
        console.warn(`[routing] ${url} a échoué:`, lastError);
      }
    }

    return estimateRoute(origin, dest, lastError);
  },
});
