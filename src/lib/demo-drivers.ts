import type { LngLat } from '@/lib/routing';

/**
 * Cinq chauffeurs en dur, éparpillés autour du passager.
 * Ils ne viennent pas de la base : ils servent uniquement à tester la demande de
 * confirmation de course tant qu'aucun vrai chauffeur n'est inscrit.
 */
export type DemoDriverProfile = {
  /** Préfixe `demo-driver-` : même convention que `conversations.driverKey`. */
  id: string;
  name: string;
  rating: number;
  vehicle: { type: string; plate: string };
};

export const DEMO_DRIVERS: readonly DemoDriverProfile[] = [
  { id: 'demo-driver-1', name: 'Awono Serge', rating: 4.9, vehicle: { type: 'Berline', plate: 'CE 204 AB' } },
  { id: 'demo-driver-2', name: 'Ngo Bakang Rose', rating: 4.7, vehicle: { type: 'Moto-taxi', plate: 'LT 881 CD' } },
  { id: 'demo-driver-3', name: 'Fotso Éric', rating: 4.8, vehicle: { type: 'SUV', plate: 'CE 517 EF' } },
  { id: 'demo-driver-4', name: 'Mbarga Junior', rating: 4.5, vehicle: { type: 'Berline', plate: 'OU 342 GH' } },
  { id: 'demo-driver-5', name: 'Tchoua Blaise', rating: 4.6, vehicle: { type: 'Van', plate: 'CE 909 IJ' } },
] as const;

const R_EARTH_M = 6371000;
const MIN_DISTANCE_M = 250;
const MAX_DISTANCE_M = 900;

/**
 * Dispersion tirée une seule fois au chargement du module : aléatoire d'un
 * lancement à l'autre, figée pendant la session — sinon les marqueurs
 * sauteraient à chaque point GPS. Un secteur angulaire par chauffeur pour
 * éviter qu'ils se superposent.
 */
const SCATTER = DEMO_DRIVERS.map((_, index) => ({
  bearingRad: ((index + Math.random()) / DEMO_DRIVERS.length) * Math.PI * 2,
  distanceM: MIN_DISTANCE_M + Math.random() * (MAX_DISTANCE_M - MIN_DISTANCE_M),
}));

/** Point à `distanceM` mètres de `center` dans la direction `bearingRad`. */
function offset(center: LngLat, bearingRad: number, distanceM: number): LngLat {
  const [lng, lat] = center;
  const toDeg = 180 / Math.PI;
  const dLat = ((distanceM * Math.cos(bearingRad)) / R_EARTH_M) * toDeg;
  const dLng =
    ((distanceM * Math.sin(bearingRad)) / (R_EARTH_M * Math.cos((lat * Math.PI) / 180))) * toDeg;
  return [lng + dLng, lat + dLat];
}

export type DemoDriver = DemoDriverProfile & { center: LngLat };

/** Les 5 profils positionnés autour d'un point d'ancrage. */
export function demoDriversAround(center: LngLat): DemoDriver[] {
  return DEMO_DRIVERS.map((profile, index) => ({
    ...profile,
    center: offset(center, SCATTER[index].bearingRad, SCATTER[index].distanceM),
  }));
}
