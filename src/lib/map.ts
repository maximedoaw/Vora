/**
 * Configuration carte (MapLibre + MapTiler), comme Yarto.
 * `EXPO_PUBLIC_MAPTILER_KEY` : tuiles + repli de géocodage.
 */

export const MAPTILER_KEY = process.env.EXPO_PUBLIC_MAPTILER_KEY ?? '';

/** Centre par défaut (Yaoundé) tant que le GPS n'a pas répondu. */
export const DEFAULT_CENTER = {
  longitude: 11.5021,
  latitude: 3.848,
  zoom: 12,
} as const;

export const FIRST_FIX_ZOOM = 16;
/** Zoom appliqué quand on sélectionne un chauffeur dans la liste. */
export const DRIVER_FOCUS_ZOOM = 17;
export const MAP_MIN_ZOOM = 3;
export const MAP_MAX_ZOOM = 20;

type MapTheme = 'light' | 'dark';

const STYLE_BY_THEME: Record<MapTheme, string> = {
  light: 'streets-v2',
  dark: 'streets-v2-dark',
};

/** Style MapTiler — utilisé par la carte web. Fallback démo si la clé manque. */
export function mapStyleUrl(theme: MapTheme): string {
  if (!MAPTILER_KEY) {
    return 'https://demotiles.maplibre.org/style.json';
  }
  return `https://api.maptiler.com/maps/${STYLE_BY_THEME[theme]}/style.json?key=${MAPTILER_KEY}`;
}
