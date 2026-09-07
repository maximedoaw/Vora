import { useMutation, useQuery } from 'convex/react';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useGeolocation, type GeoState } from '@/hooks/use-geolocation';
import { api } from '../../convex/_generated/api';

/** Rythme d'enregistrement de la position en base — 2 à 3 minutes. */
const SYNC_INTERVAL_MS = 150_000;

/** Approche : le passager doit voir son chauffeur avancer vers lui. */
const APPROACH_SYNC_INTERVAL_MS = 15_000;

/**
 * Le passager pendant l'approche. Il n'a rien à faire voir, mais sa position
 * sert à détecter la jonction à 5 m : la laisser vieillir la rendrait
 * impossible.
 */
const RIDER_APPROACH_SYNC_INTERVAL_MS = 30_000;

/**
 * Une fois à bord, chauffeur et passager avancent ensemble vers la destination
 * et les deux téléphones alimentent la même position suivie : une minute
 * suffit, et ménage deux batteries au lieu d'une.
 */
const ONBOARD_SYNC_INTERVAL_MS = 60_000;

type ActiveRide = { asDriver: boolean; status: string } | null | undefined;

/** Rythme d'envoi selon l'étape de la course en cours. */
function syncInterval(ride: ActiveRide): number {
  if (!ride) return SYNC_INTERVAL_MS;
  if (ride.status === 'in_progress') return ONBOARD_SYNC_INTERVAL_MS;
  // Une course encore `requested` n'engage personne : rien à suivre.
  if (ride.status !== 'matched') return SYNC_INTERVAL_MS;
  return ride.asDriver ? APPROACH_SYNC_INTERVAL_MS : RIDER_APPROACH_SYNC_INTERVAL_MS;
}

const GeoContext = createContext<GeoState | null>(null);

/**
 * Une seule souscription GPS pour toute l'application authentifiée.
 *
 * `watchPositionAsync` est coûteux : monter `useGeolocation` dans chaque écran
 * ouvrirait autant de veilles. Le contexte le fait une fois, et la carte comme
 * la messagerie y puisent la même position.
 */
export function GeolocationProvider({ children }: { children: ReactNode }) {
  const geo = useGeolocation({ auto: true });

  return (
    <GeoContext.Provider value={geo}>
      <PositionSync geo={geo} />
      {children}
    </GeoContext.Provider>
  );
}

export function useGeo(): GeoState {
  const geo = useContext(GeoContext);
  if (!geo) throw new Error('useGeo doit être utilisé sous <GeolocationProvider>.');
  return geo;
}

/**
 * Écrit la position dans `users` : tout de suite au premier point connu — donc
 * dès la création du compte — puis à un rythme qui dépend de la course en
 * cours, de 2 min 30 au repos à 15 s pendant l'approche d'un chauffeur.
 *
 * Le rythme vient d'un intervalle, pas des points GPS : à l'arrêt le capteur
 * n'émet plus rien et la position en base ne vieillirait jamais proprement.
 * Le serveur ignore de son côté les écritures trop rapprochées.
 */
function PositionSync({ geo }: { geo: GeoState }) {
  const updatePosition = useMutation(api.users.updatePosition);
  const activeRide = useQuery(api.rides.activeForMe, {});
  const positionRef = useRef(geo.position);
  positionRef.current = geo.position;

  // Les deux parties accélèrent désormais : avant la jonction pour qu'elle soit
  // détectable, après pour que le trajet avance sur les deux écrans à la fois.
  const interval = syncInterval(activeRide);

  const sentOnce = useRef(false);

  const push = useCallback(
    (immediate: boolean) => {
      const position = positionRef.current;
      if (!position) return;
      void updatePosition({ lat: position.lat, lng: position.lng, immediate }).catch((error) => {
        console.warn('[position] enregistrement impossible', error);
      });
    },
    [updatePosition],
  );

  // Premier point connu : enregistré sans attendre le prochain cycle.
  useEffect(() => {
    if (sentOnce.current || !geo.position) return;
    sentOnce.current = true;
    push(true);
  }, [geo.position, push]);

  // Intervalle monté une seule fois : le remonter à chaque point GPS
  // (toutes les 2,5 s en déplacement) l'empêcherait d'arriver à échéance.
  useEffect(() => {
    const timer = setInterval(() => {
      if (AppState.currentState !== 'active') return;
      push(false);
    }, interval);

    return () => clearInterval(timer);
  }, [interval, push]);

  return null;
}
