import { useMutation, useQuery } from 'convex/react';
import { createContext, useCallback, useContext, useEffect, useRef, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { useGeolocation, type GeoState } from '@/hooks/use-geolocation';
import { api } from '../../convex/_generated/api';

/** Rythme d'enregistrement de la position en base — 2 à 3 minutes. */
const SYNC_INTERVAL_MS = 150_000;
/** Pendant une course, le passager doit voir son chauffeur avancer. */
const RIDE_SYNC_INTERVAL_MS = 15_000;

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
 * dès la création du compte — puis toutes les 2 min 30, ou toutes les 15 s
 * quand l'utilisateur conduit une course (le serveur en alimente le suivi).
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

  // Seul le chauffeur d'une course active accélère : le passager n'a rien à suivre.
  const driving = activeRide?.asDriver === true;
  const interval = driving ? RIDE_SYNC_INTERVAL_MS : SYNC_INTERVAL_MS;

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
