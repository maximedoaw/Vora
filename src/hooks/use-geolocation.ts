import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';

export type GeoPosition = {
  lat: number;
  lng: number;
  heading: number | null;
  accuracy: number;
};

export type GeoStatus =
  | 'idle'
  | 'prompting'
  | 'granted'
  | 'denied'
  | 'unavailable'
  | 'error';

export type GeoState = {
  position: GeoPosition | null;
  status: GeoStatus;
  error: string | null;
  requestOnce: () => void;
};

function toPosition(loc: Location.LocationObject): GeoPosition {
  return {
    lat: loc.coords.latitude,
    lng: loc.coords.longitude,
    heading:
      typeof loc.coords.heading === 'number' && !Number.isNaN(loc.coords.heading)
        ? loc.coords.heading
        : null,
    accuracy: loc.coords.accuracy ?? 0,
  };
}

/**
 * Demande la localisation au premier chargement de la carte, puis suit le GPS.
 */
export function useGeolocation({ auto = true }: { auto?: boolean } = {}): GeoState {
  const [position, setPosition] = useState<GeoPosition | null>(null);
  const [status, setStatus] = useState<GeoStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const subRef = useRef<Location.LocationSubscription | null>(null);
  const started = useRef(false);

  const handleError = useCallback((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err ?? '');
    if (/denied|permission/i.test(message)) {
      setStatus('denied');
      setError('Localisation refusée.');
      return;
    }
    setStatus('error');
    setError("Impossible d'obtenir ta position.");
  }, []);

  const startWatch = useCallback(async () => {
    if (started.current) return;
    started.current = true;
    try {
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setPosition(toPosition(current));
      setStatus('granted');
      setError(null);

      subRef.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          distanceInterval: 8,
          timeInterval: 2500,
        },
        (loc) => {
          setPosition(toPosition(loc));
          setStatus('granted');
          setError(null);
        },
      );
    } catch (err) {
      started.current = false;
      handleError(err);
    }
  }, [handleError]);

  const requestOnce = useCallback(() => {
    void (async () => {
      setStatus('prompting');
      setError(null);
      try {
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (perm !== 'granted') {
          setStatus('denied');
          setError('Localisation refusée.');
          return;
        }
        started.current = false;
        await startWatch();
      } catch (err) {
        handleError(err);
      }
    })();
  }, [handleError, startWatch]);

  useEffect(() => {
    if (!auto) return;

    let cancelled = false;
    void (async () => {
      try {
        const enabled = await Location.hasServicesEnabledAsync();
        if (!enabled) {
          if (!cancelled) {
            setStatus('unavailable');
            setError('Active le GPS dans les réglages du téléphone.');
          }
          return;
        }

        const existing = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;

        if (existing.status === 'granted') {
          setStatus('prompting');
          await startWatch();
          return;
        }

        if (existing.status === 'denied' && existing.canAskAgain === false) {
          setStatus('denied');
          setError('Localisation refusée. Autorise-la dans les réglages, puis réessaie.');
          return;
        }

        setStatus('prompting');
        const { status: perm } = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm !== 'granted') {
          setStatus('denied');
          setError('Localisation refusée.');
          return;
        }
        await startWatch();
      } catch (err) {
        if (!cancelled) handleError(err);
      }
    })();

    return () => {
      cancelled = true;
      subRef.current?.remove();
      subRef.current = null;
      started.current = false;
    };
  }, [auto, handleError, startWatch]);

  return { position, status, error, requestOnce };
}
