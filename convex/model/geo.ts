/**
 * Géométrie de base côté serveur, sans dépendance.
 *
 * `rides` et `drivers` gardent leur propre `haversineKm` pour ne pas être
 * touchés ; tout ce qui est nouveau passe par ici.
 */

const R_EARTH_KM = 6371;
const toRad = (d: number) => (d * Math.PI) / 180;

export type Point = { lat: number; lng: number };

export function haversineKm(a: Point, b: Point): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/**
 * Point situé à `progress` (0 → 1) entre `from` et `to`.
 *
 * Interpolation linéaire sur la corde, pas sur le tracé routier : à l'échelle
 * d'une course urbaine l'écart reste de l'ordre de la centaine de mètres, et
 * ces points ne servent qu'à situer un passager sur la carte.
 */
export function interpolate(from: Point, to: Point, progress: number): Point {
  const t = clamp01(progress);
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}

/**
 * Décale un point de `meters` perpendiculairement à l'axe `from → to`.
 * Un passager attend au bord de la route, pas sur la ligne théorique.
 */
export function offsetAcross(point: Point, from: Point, to: Point, meters: number): Point {
  const cosLat = Math.cos(toRad(point.lat)) || 1;
  // Axe du trajet ramené en mètres, puis normale unitaire.
  const dx = (to.lng - from.lng) * cosLat;
  const dy = to.lat - from.lat;
  const norm = Math.hypot(dx, dy);
  if (norm === 0) return point;

  const degPerMeter = 1 / 111_320;
  return {
    lat: point.lat + (-dx / norm) * meters * degPerMeter,
    lng: point.lng + ((dy / norm) * meters * degPerMeter) / cosLat,
  };
}
