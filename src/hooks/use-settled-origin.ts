import { useEffect, useState } from 'react';

import { haversineKm } from '@/lib/geo-utils';
import type { LngLat } from '@/lib/routing';

/** En dessous de ce déplacement, l'itinéraire n'est pas recalculé. */
const DEFAULT_MIN_MOVE_M = 60;

/**
 * Point de départ « stable » pour le routage.
 *
 * `watchPositionAsync` remonte une position toutes les 2,5 s / 8 m : sans ce
 * filtre, le moindre tremblement GPS relançait un calcul ORS complet et faisait
 * clignoter le tracé. On ne renvoie une nouvelle référence que si le passager
 * s'est réellement déplacé.
 */
export function useSettledOrigin(
  lng: number | undefined,
  lat: number | undefined,
  minMoveM: number = DEFAULT_MIN_MOVE_M,
): LngLat | null {
  const [origin, setOrigin] = useState<LngLat | null>(null);

  useEffect(() => {
    if (lng == null || lat == null) return;
    setOrigin((previous) => {
      if (previous && haversineKm(previous, [lng, lat]) * 1000 < minMoveM) return previous;
      return [lng, lat];
    });
  }, [lat, lng, minMoveM]);

  return origin;
}
