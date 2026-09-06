import { useAction } from 'convex/react';
import { useEffect, useRef, useState } from 'react';

import {
  estimateRoute,
  fetchRoute,
  isRouteResult,
  orsApiKey,
  type LngLat,
  type RouteResult,
} from '@/lib/routing';
import { api } from '../../convex/_generated/api';

export type RouteStatus = 'idle' | 'loading' | 'ready' | 'error';

const DEBOUNCE_MS = 280;

/**
 * Calcule un itinéraire routier (ORS).
 * 1) Clé Expo (`.env.local` via app.config) — le cas Expo Go.
 * 2) Action Convex si la clé n'est que côté serveur.
 * 3) Repli vol d'oiseau uniquement si ORS est injoignable — dans ce cas
 *    `route.error` porte la raison, affichée dans la carte d'itinéraire.
 *
 * Le tracé n'est effacé que si la **destination** change : un simple
 * rafraîchissement de la position de départ garde l'ancien tracé à l'écran
 * jusqu'à l'arrivée du nouveau, sinon la ligne clignote à chaque point GPS.
 */
export function useRoute(
  from: LngLat | null,
  to: LngLat | null,
): { route: RouteResult | null; status: RouteStatus } {
  const getDirections = useAction(api.routing.getDirections);
  const [route, setRoute] = useState<RouteResult | null>(null);
  const [status, setStatus] = useState<RouteStatus>('idle');
  const destKeyRef = useRef<string | null>(null);

  const fromLng = from?.[0];
  const fromLat = from?.[1];
  const toLng = to?.[0];
  const toLat = to?.[1];

  useEffect(() => {
    if (fromLng == null || fromLat == null || toLng == null || toLat == null) {
      destKeyRef.current = null;
      setRoute(null);
      setStatus('idle');
      return;
    }

    const destKey = `${toLng},${toLat}`;
    const destChanged = destKeyRef.current !== destKey;
    destKeyRef.current = destKey;

    const a: LngLat = [fromLng, fromLat];
    const b: LngLat = [toLng, toLat];
    const ac = new AbortController();
    setStatus('loading');
    if (destChanged) setRoute(null);

    const t = setTimeout(() => {
      void (async () => {
        const apply = (result: RouteResult) => {
          if (ac.signal.aborted) return;
          setRoute(result);
          setStatus('ready');
        };

        let reason = 'Clé ORS absente côté app';

        if (orsApiKey()) {
          try {
            const ors = await fetchRoute(a, b, { signal: ac.signal });
            if (ors.source === 'ors' && ors.geometry.coordinates.length >= 2) {
              apply(ors);
              return;
            }
            reason = ors.error ?? 'ORS a renvoyé un tracé vide';
          } catch (error) {
            if ((error as Error).name === 'AbortError' || ac.signal.aborted) return;
            reason = (error as Error).message;
            console.warn('[route] ORS client a échoué', error);
          }
        }

        try {
          const convex = await getDirections({ from: a, to: b });
          if (ac.signal.aborted) return;
          if (isRouteResult(convex) && convex.source === 'ors') {
            apply(convex);
            return;
          }
          if (isRouteResult(convex) && convex.error) reason = convex.error;
        } catch (error) {
          if ((error as Error).name === 'AbortError' || ac.signal.aborted) return;
          reason = (error as Error).message;
          console.warn('[route] Convex directions a échoué', error);
        }

        console.warn('[route] repli sur une estimation à vol d’oiseau —', reason);
        apply(estimateRoute(a, b, undefined, reason));
      })();
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(t);
      ac.abort();
    };
  }, [fromLng, fromLat, getDirections, toLng, toLat]);

  return { route, status };
}
