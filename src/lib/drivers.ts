import type { LngLat } from '@/lib/routing';

/** Chauffeur affichable : profil Convex réel ou profil de test en dur. */
export type RideDriver = {
  id: string;
  name: string;
  rating: number | null;
  vehicle: { type: string; plate: string } | null;
  /** `true` = profil en dur, servant à tester la demande de confirmation. */
  demo: boolean;
  /** Disponibilité déclarée par le chauffeur depuis son espace. */
  isAvailable: boolean;
  /** Distance au passager en km, `null` si l'une des deux positions manque. */
  distanceKm: number | null;
  /**
   * Position simulée des profils de test. `null` pour un vrai chauffeur : hors
   * course, aucune position n'est stockée (`driverPositions` est indexée par ride).
   */
  position: LngLat | null;
};

/** Préfixe des profils de test (`demo-driver-1`…). */
export const DEMO_DRIVER_PREFIX = 'demo-driver-';

export function isDemoDriverKey(key: string | undefined | null): boolean {
  return !!key && key.startsWith(DEMO_DRIVER_PREFIX);
}
