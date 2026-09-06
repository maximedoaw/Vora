import { createElement, forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  FIRST_FIX_ZOOM,
  INITIAL_CAMERA,
  type MapCameraHandle,
  type NativeMapProps,
} from '@/components/map/native-map-shared';
import { useAppTheme } from '@/hooks/use-app-theme';
import { downsampleCoords } from '@/lib/geo-utils';
import { mapStyleUrl } from '@/lib/map';
import { carIconSvg } from '@/lib/map-icons';

type MapInstance = {
  flyTo: (opts: { center: [number, number]; zoom: number; duration: number }) => void;
  fitBounds: (
    b: [[number, number], [number, number]],
    o: { padding: number; duration: number; maxZoom: number },
  ) => void;
  addSource: (id: string, src: unknown) => void;
  addLayer: (layer: unknown) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  getLayer: (id: string) => unknown;
  isStyleLoaded: () => boolean;
  setStyle: (style: string) => void;
  resize: () => void;
  remove: () => void;
  once: (event: string, cb: () => void) => void;
  on: (event: string, cb: () => void) => void;
};

type MarkerInstance = {
  setLngLat: (ll: [number, number]) => MarkerInstance;
  addTo: (map: MapInstance) => MarkerInstance;
  remove: () => void;
};

type MapLibre = {
  Map: new (opts: Record<string, unknown>) => MapInstance;
  Marker: new (opts: { element?: HTMLElement }) => MarkerInstance;
};

/** Pastille chauffeur — styles en ligne, la WebView native a sa propre CSS. */
function driverPin(): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = [
    'display:flex',
    'align-items:center',
    'gap:4px',
    'border-radius:14px',
    'padding:3px 8px',
    'font:600 11px/1.1 -apple-system, Roboto, system-ui, sans-serif',
    'white-space:nowrap',
    'box-shadow:0 2px 6px rgba(0,0,0,0.45)',
  ].join(';');
  el.innerHTML =
    '<span data-glyph style="display:flex;align-items:center"></span><span data-label></span>';
  return el;
}

export const NativeMap = forwardRef<MapCameraHandle, NativeMapProps>(function NativeMapWeb(
  { destination, route, drivers, selectedDriverId },
  ref,
) {
  const { scheme, colors } = useAppTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const driverMarkersRef = useRef<Map<string, { el: HTMLDivElement; marker: MarkerInstance }>>(
    new Map(),
  );

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom = FIRST_FIX_ZOOM) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 900 });
    },
    fitRoute(coords) {
      if (!mapRef.current || coords.length < 2) return;
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      mapRef.current.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 80, duration: 800, maxZoom: 16 },
      );
    },
  }));

  const schemeRef = useRef(scheme);
  schemeRef.current = scheme;

  useEffect(() => {
    let cancelled = false;
    let map: MapInstance | null = null;
    void (async () => {
      const maplibregl = (await import('maplibre-gl')) as unknown as MapLibre;
      if (cancelled || !hostRef.current) return;
      libRef.current = maplibregl;
      map = new maplibregl.Map({
        container: hostRef.current,
        style: mapStyleUrl(schemeRef.current),
        center: [INITIAL_CAMERA.coordinates.longitude, INITIAL_CAMERA.coordinates.latitude],
        zoom: INITIAL_CAMERA.zoom,
        fadeDuration: 0,
      });
      map.on('load', () => map?.resize());
      map.on('idle', () => map?.resize());
      mapRef.current = map;
      requestAnimationFrame(() => map?.resize());
    })();
    return () => {
      cancelled = true;
      driverMarkersRef.current.forEach((entry) => entry.marker.remove());
      driverMarkersRef.current.clear();
      map?.remove();
      mapRef.current = null;
      libRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib) return;

    const markers = driverMarkersRef.current;
    const seen = new Set<string>();

    (drivers ?? []).forEach((driver) => {
      seen.add(driver.id);
      let entry = markers.get(driver.id);
      if (!entry) {
        const el = driverPin();
        entry = { el, marker: new lib.Marker({ element: el }).setLngLat(driver.center).addTo(map) };
        markers.set(driver.id, entry);
      } else {
        entry.marker.setLngLat(driver.center);
      }

      const selected = driver.id === selectedDriverId;
      const outline = selected
        ? colors.accent
        : driver.demo
          ? colors.warningBorder
          : colors.borderStrong;

      entry.el.style.color = colors.text;
      entry.el.style.background = selected ? colors.accentSoft : colors.surface;
      entry.el.style.border = `1px ${driver.demo ? 'dashed' : 'solid'} ${outline}`;
      entry.el.style.opacity = driver.available ? '1' : '0.62';

      const glyph = entry.el.querySelector('[data-glyph]');
      const label = entry.el.querySelector('[data-label]');
      if (glyph) {
        glyph.innerHTML = carIconSvg(driver.available ? colors.accent : colors.textMuted);
      }
      if (label) label.textContent = driver.label;
    });

    markers.forEach((entry, id) => {
      if (seen.has(id)) return;
      entry.marker.remove();
      markers.delete(id);
    });
  }, [colors, drivers, selectedDriverId]);

  useEffect(() => {
    mapRef.current?.setStyle(mapStyleUrl(scheme));
  }, [scheme]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const paint = () => {
      const coords = route ? downsampleCoords(route.geometry.coordinates, 600) : [];
      const data = {
        type: 'Feature' as const,
        geometry: { type: 'LineString' as const, coordinates: coords },
        properties: {},
      };
      const source = map.getSource('route');
      if (source) {
        source.setData(data);
        return;
      }
      if (coords.length < 2) return;
      map.addSource('route', { type: 'geojson', data });
      if (!map.getLayer('route-line')) {
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: { 'line-color': colors.accent, 'line-width': 5 },
        });
      }
    };
    if (map.isStyleLoaded()) paint();
    else map.once('idle', paint);
  }, [colors.accent, destination, route, scheme]);

  return (
    <View style={[styles.root, { backgroundColor: colors.mapBackground }]}>
      {createElement('div', {
        ref: hostRef,
        style: { width: '100%', height: '100%' },
      })}
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
