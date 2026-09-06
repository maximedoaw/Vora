/** Utilitaires géo légers (zéro dépendance) pour le client. */

const R_EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

/** Distance à vol d'oiseau (haversine) entre deux [lng, lat], en km. */
export function haversineKm(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** "850 m" / "2,4 km" / "12 km". */
export function formatDistance(km: number): string {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}

/** "< 1 min" / "12 min" / "1 h 05". */
export function formatDuration(seconds: number): string {
  const min = Math.round(seconds / 60);
  if (min < 1) return '< 1 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/** Boîte englobante [minLng, minLat, maxLng, maxLat]. */
export function bboxOfCoords(coords: [number, number][]): [number, number, number, number] {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of coords) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

/** Arrondit une coordonnée — évite de relancer un calcul à chaque micro-variation GPS. */
export function quantize(coord: [number, number], decimals = 4): [number, number] {
  const f = 10 ** decimals;
  return [Math.round(coord[0] * f) / f, Math.round(coord[1] * f) / f];
}

/** Réduit une polyligne trop dense pour le rendu natif. */
export function downsampleCoords(
  coords: [number, number][],
  maxPoints = 600,
): [number, number][] {
  if (coords.length <= maxPoints) return coords;
  const step = Math.ceil(coords.length / maxPoints);
  return coords.filter((_, i) => i % step === 0 || i === coords.length - 1);
}
