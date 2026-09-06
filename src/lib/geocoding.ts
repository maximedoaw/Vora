import { MAPTILER_KEY } from '@/lib/map';

/**
 * Restreint les résultats à un/des pays (ISO 3166-1 alpha-2).
 * VTC local → Cameroun par défaut. `EXPO_PUBLIC_GEOCODING_COUNTRY=""` = monde.
 */
const GEOCODING_COUNTRY = (process.env.EXPO_PUBLIC_GEOCODING_COUNTRY ?? 'CM').toUpperCase();

const COUNTRY_CODES = GEOCODING_COUNTRY
  ? GEOCODING_COUNTRY.split(',').map((c) => c.trim())
  : [];

export type GeocodeFeature = {
  id: string;
  text: string;
  place_name: string;
  center: [number, number];
  bbox?: [number, number, number, number];
  kind?: string;
  source: 'photon' | 'maptiler';
};

type PhotonFeature = {
  properties: {
    osm_id?: number | string;
    name?: string;
    osm_key?: string;
    osm_value?: string;
    housenumber?: string;
    street?: string;
    district?: string;
    city?: string;
    country?: string;
    countrycode?: string;
    extent?: [number, number, number, number];
  };
  geometry: { coordinates: [number, number] };
};

function photonToFeature(f: PhotonFeature, i: number): GeocodeFeature {
  const p = f.properties;
  const [lng, lat] = f.geometry.coordinates;
  const primary =
    p.name || [p.housenumber, p.street].filter(Boolean).join(' ') || p.city || 'Lieu';
  const context = [p.street && p.street !== primary ? p.street : null, p.district, p.city, p.country]
    .filter((v): v is string => Boolean(v))
    .filter((v, idx, arr) => arr.indexOf(v) === idx)
    .join(', ');

  let bbox: GeocodeFeature['bbox'];
  if (p.extent && p.extent.length === 4) {
    const [w, n, e, s] = p.extent;
    bbox = [w, s, e, n];
  }

  return {
    id: `photon:${p.osm_id ?? `${lng},${lat}`}:${i}`,
    text: primary,
    place_name: context || primary,
    center: [lng, lat],
    bbox,
    kind: p.osm_value ?? p.osm_key,
    source: 'photon',
  };
}

async function photonSearch(
  q: string,
  proximity: [number, number] | undefined,
  signal: AbortSignal | undefined,
): Promise<GeocodeFeature[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', q);
  url.searchParams.set('lang', 'fr');
  url.searchParams.set('limit', '20');
  if (proximity) {
    url.searchParams.set('lon', String(proximity[0]));
    url.searchParams.set('lat', String(proximity[1]));
  }

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features: PhotonFeature[] };

  let feats = data.features ?? [];
  if (COUNTRY_CODES.length) {
    const local = feats.filter(
      (f) => !f.properties.countrycode || COUNTRY_CODES.includes(f.properties.countrycode),
    );
    feats = local.length ? local : feats;
  }
  return feats.slice(0, 10).map(photonToFeature);
}

async function maptilerSearch(
  q: string,
  proximity: [number, number] | undefined,
  signal: AbortSignal | undefined,
): Promise<GeocodeFeature[]> {
  if (!MAPTILER_KEY) return [];
  const url = new URL(`https://api.maptiler.com/geocoding/${encodeURIComponent(q)}.json`);
  url.searchParams.set('key', MAPTILER_KEY);
  url.searchParams.set('autocomplete', 'true');
  url.searchParams.set('limit', '6');
  url.searchParams.set('language', 'fr');
  if (COUNTRY_CODES.length) url.searchParams.set('country', COUNTRY_CODES.join(',').toLowerCase());
  if (proximity) url.searchParams.set('proximity', `${proximity[0]},${proximity[1]}`);

  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`MapTiler ${res.status}`);
  const data = (await res.json()) as {
    features: Array<{
      id: string;
      text: string;
      place_name: string;
      center: [number, number];
      bbox?: [number, number, number, number];
      place_type?: string[];
    }>;
  };
  return data.features.map((f) => ({
    id: `maptiler:${f.id}`,
    text: f.text,
    place_name: f.place_name,
    center: f.center,
    bbox: f.bbox,
    kind: f.place_type?.[0],
    source: 'maptiler' as const,
  }));
}

function dedupe(features: GeocodeFeature[]): GeocodeFeature[] {
  const seen = new Set<string>();
  const out: GeocodeFeature[] = [];
  for (const f of features) {
    const name = f.text.toLowerCase().trim();
    const byContext = `${name}|${f.place_name.toLowerCase().trim()}`;
    const byCoord = `${name}@${f.center[0].toFixed(2)},${f.center[1].toFixed(2)}`;
    if (seen.has(byContext) || seen.has(byCoord)) continue;
    seen.add(byContext);
    seen.add(byCoord);
    out.push(f);
  }
  return out;
}

const CACHE_TTL = 5 * 60_000;
const CACHE_MAX = 60;
const cache = new Map<string, { t: number; data: GeocodeFeature[] }>();

function cacheKey(q: string, proximity?: [number, number]) {
  const p = proximity ? `${proximity[0].toFixed(2)},${proximity[1].toFixed(2)}` : '';
  return `${q.toLowerCase()}|${p}`;
}

export async function geocode(
  query: string,
  { proximity, signal }: { proximity?: [number, number]; signal?: AbortSignal } = {},
): Promise<GeocodeFeature[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const key = cacheKey(q, proximity);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < CACHE_TTL) return hit.data;

  let result: GeocodeFeature[] = [];
  try {
    result = dedupe(await photonSearch(q, proximity, signal));
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
  }
  if (result.length === 0) {
    result = dedupe(await maptilerSearch(q, proximity, signal));
  }

  result = result.slice(0, 8);
  cache.set(key, { t: Date.now(), data: result });
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return result;
}

const REVERSE_CACHE_TTL = 10 * 60_000;
const reverseCache = new Map<string, { t: number; data: GeocodeFeature | null }>();

/** ~11 m : inutile de redemander un nom de lieu pour un pas de GPS. */
function reverseKey(center: [number, number]) {
  return `${center[0].toFixed(4)},${center[1].toFixed(4)}`;
}

/**
 * Nom du lieu correspondant à des coordonnées (Photon, repli MapTiler).
 * Renvoie `null` plutôt que de lever : un partage de position doit partir même
 * sans nom lisible.
 */
export async function reverseGeocode(
  center: [number, number],
  { signal }: { signal?: AbortSignal } = {},
): Promise<GeocodeFeature | null> {
  const key = reverseKey(center);
  const hit = reverseCache.get(key);
  if (hit && Date.now() - hit.t < REVERSE_CACHE_TTL) return hit.data;

  const [lng, lat] = center;
  let feature: GeocodeFeature | null = null;

  try {
    const url = new URL('https://photon.komoot.io/reverse');
    url.searchParams.set('lon', String(lng));
    url.searchParams.set('lat', String(lat));
    url.searchParams.set('lang', 'fr');
    url.searchParams.set('limit', '1');

    const res = await fetch(url, { signal });
    if (res.ok) {
      const data = (await res.json()) as { features?: PhotonFeature[] };
      const first = data.features?.[0];
      if (first) feature = photonToFeature(first, 0);
    }
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
  }

  if (!feature && MAPTILER_KEY) {
    try {
      const url = new URL(`https://api.maptiler.com/geocoding/${lng},${lat}.json`);
      url.searchParams.set('key', MAPTILER_KEY);
      url.searchParams.set('limit', '1');
      url.searchParams.set('language', 'fr');

      const res = await fetch(url, { signal });
      if (res.ok) {
        const data = (await res.json()) as {
          features?: Array<{ id: string; text: string; place_name: string; center: [number, number] }>;
        };
        const first = data.features?.[0];
        if (first) {
          feature = {
            id: `maptiler:${first.id}`,
            text: first.text,
            place_name: first.place_name,
            center: first.center,
            source: 'maptiler',
          };
        }
      }
    } catch (error) {
      if ((error as Error).name === 'AbortError') throw error;
    }
  }

  reverseCache.set(key, { t: Date.now(), data: feature });
  if (reverseCache.size > CACHE_MAX) {
    reverseCache.delete(reverseCache.keys().next().value as string);
  }
  return feature;
}
