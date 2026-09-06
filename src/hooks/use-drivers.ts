import { useQuery } from 'convex/react';
import { useMemo, useRef } from 'react';

import { demoDriversAround } from '@/lib/demo-drivers';
import type { RideDriver } from '@/lib/drivers';
import { haversineKm } from '@/lib/geo-utils';
import type { LngLat } from '@/lib/routing';
import { api } from '../../convex/_generated/api';

/**
 * Disponibles d'abord, puis les plus proches, puis les mieux notés — même règle
 * que le serveur, réappliquée après fusion avec les profils de test pour que la
 * liste reste cohérente de bout en bout.
 */
function rank(a: RideDriver, b: RideDriver): number {
  if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;

  const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;

  const ra = a.rating ?? -1;
  const rb = b.rating ?? -1;
  if (ra !== rb) return rb - ra;

  return a.name.localeCompare(b.name, 'fr');
}

/**
 * Chauffeurs proposés au passager : ceux de la base et les 5 profils de test,
 * classés ensemble par disponibilité puis par distance.
 *
 * Les profils de test sont ancrés au **premier** point GPS connu et n'en bougent
 * plus : des marqueurs qui suivraient le passager seraient illisibles.
 */
export function useDrivers(origin: LngLat | null): { drivers: RideDriver[]; loading: boolean } {
  const stored = useQuery(
    api.drivers.listSuggested,
    origin ? { lng: origin[0], lat: origin[1] } : {},
  );

  const anchorRef = useRef<LngLat | null>(null);
  if (!anchorRef.current && origin) anchorRef.current = origin;
  const anchor = anchorRef.current;

  return useMemo(() => {
    const fromDb: RideDriver[] = (stored ?? []).map((driver) => ({
      id: driver.id,
      name: driver.name,
      rating: driver.rating,
      vehicle: driver.vehicle,
      demo: false,
      isAvailable: driver.isAvailable,
      distanceKm: driver.distanceKm,
      position: driver.position,
    }));

    const demo: RideDriver[] = anchor
      ? demoDriversAround(anchor).map((driver) => ({
          id: driver.id,
          name: driver.name,
          rating: driver.rating,
          vehicle: driver.vehicle,
          demo: true,
          // Les profils de test se présentent toujours comme disponibles.
          isAvailable: true,
          distanceKm: origin ? haversineKm(origin, driver.center) : null,
          position: driver.center,
        }))
      : [];

    return { drivers: [...fromDb, ...demo].sort(rank), loading: stored === undefined };
  }, [anchor, origin, stored]);
}
