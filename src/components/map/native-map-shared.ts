import { bboxOfCoords } from '@/lib/geo-utils';
import { DEFAULT_CENTER, FIRST_FIX_ZOOM } from '@/lib/map';
import type { GeocodeFeature } from '@/lib/geocoding';
import type { GeoPosition } from '@/hooks/use-geolocation';
import type { RouteResult } from '@/lib/routing';

/** Chauffeur épinglé sur la carte (aujourd'hui : les profils de test). */
export type MapDriver = {
  id: string;
  label: string;
  center: [number, number];
  demo: boolean;
  /** Colore la pastille : disponible en vert, occupé en gris. */
  available: boolean;
};

/** Vue à plat, ou caméra inclinée avec bâtiments extrudés. */
export type MapViewMode = '2d' | '3d';

/**
 * État de la simulation de trajet. `paused` conserve l'avancement : reprendre
 * repart de là où le véhicule s'est arrêté, jamais du début.
 */
export type MapSimState = 'idle' | 'running' | 'paused';

/** Inclinaison de la caméra en 3D — partagée par la WebView et la carte web. */
export const PITCH_3D = 58;

/** Zoom du suivi orienté : assez près pour lire la rue qui arrive. */
export const FOLLOW_ZOOM = 17;

export type MapCameraHandle = {
  flyTo: (lng: number, lat: number, zoom?: number) => void;
  fitRoute: (coords: [number, number][]) => void;
};

export type NativeMapProps = {
  userPosition: GeoPosition | null;
  destination: GeocodeFeature | null;
  route: RouteResult | null;
  drivers?: MapDriver[];
  selectedDriverId?: string | null;
};

export const INITIAL_CAMERA = {
  coordinates: {
    latitude: DEFAULT_CENTER.latitude,
    longitude: DEFAULT_CENTER.longitude,
  },
  zoom: DEFAULT_CENTER.zoom,
};

export function zoomFromCoords(coords: [number, number][]): number {
  const [minLng, minLat, maxLng, maxLat] = bboxOfCoords(coords);
  const delta = Math.max(maxLat - minLat, maxLng - minLng, 0.002);
  return Math.min(16, Math.max(10, Math.log2(360 / delta) - 1.2));
}

export function centerOfCoords(coords: [number, number][]) {
  const [minLng, minLat, maxLng, maxLat] = bboxOfCoords(coords);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
  };
}

export { FIRST_FIX_ZOOM };
