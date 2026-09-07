import {
  createElement,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

import { MapControls } from '@/components/map/map-controls';
import {
  FIRST_FIX_ZOOM,
  FOLLOW_ZOOM,
  INITIAL_CAMERA,
  PITCH_3D,
  type MapCameraHandle,
  type MapSimState,
  type MapViewMode,
  type NativeMapProps,
} from '@/components/map/native-map-shared';
import { useAppTheme } from '@/hooks/use-app-theme';
import { downsampleCoords } from '@/lib/geo-utils';
import { mapStyleUrl } from '@/lib/map';
import { carIconSvg } from '@/lib/map-icons';
import {
  averageSpeedKmh,
  planSimulation,
  sampleSimulation,
  type SimPlan,
  type SimSample,
} from '@/lib/route-sim';

type CameraOptions = {
  center?: [number, number];
  zoom?: number;
  pitch?: number;
  bearing?: number;
  duration?: number;
};

type Handler = { enable: () => void; disable: () => void };

type StyleSpec = {
  layers?: { id: string; type: string; source?: string; 'source-layer'?: string }[];
};

type MapInstance = {
  flyTo: (opts: { center: [number, number]; zoom: number; duration: number }) => void;
  easeTo: (opts: CameraOptions) => void;
  jumpTo: (opts: CameraOptions) => void;
  fitBounds: (
    b: [[number, number], [number, number]],
    o: { padding: number; duration: number; maxZoom: number; pitch?: number },
  ) => void;
  addSource: (id: string, src: unknown) => void;
  addLayer: (layer: unknown, beforeId?: string) => void;
  removeLayer: (id: string) => void;
  getSource: (id: string) => { setData: (data: unknown) => void } | undefined;
  getLayer: (id: string) => unknown;
  getStyle: () => StyleSpec | undefined;
  getZoom: () => number;
  getBearing: () => number;
  isStyleLoaded: () => boolean;
  setStyle: (style: string) => void;
  resize: () => void;
  remove: () => void;
  once: (event: string, cb: () => void) => void;
  on: (event: string, cb: () => void) => void;
  dragRotate: Handler;
  touchPitch: Handler;
};

type MarkerInstance = {
  setLngLat: (ll: [number, number]) => MarkerInstance;
  setRotation: (deg: number) => MarkerInstance;
  addTo: (map: MapInstance) => MarkerInstance;
  remove: () => void;
};

type MapLibre = {
  Map: new (opts: Record<string, unknown>) => MapInstance;
  Marker: new (opts: { element?: HTMLElement; rotationAlignment?: string }) => MarkerInstance;
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

const BUILDING_LAYER = 'vora-buildings-3d';

/** Cap de A vers B, en degrés depuis le nord. */
function bearingTo(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const lat1 = a[1] * toRad;
  const lat2 = b[1] * toRad;
  const dLng = (b[0] - a[0]) * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Orientation de la caméra : le tronçon d'itinéraire qui suit l'utilisateur. */
function routeBearing(coords: [number, number][], ll: [number, number]): number | null {
  if (coords.length < 2) return null;

  let best = 0;
  let bestD = Infinity;
  coords.forEach((point, index) => {
    const d = (point[0] - ll[0]) ** 2 + (point[1] - ll[1]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = index;
    }
  });

  const next = Math.min(best + 3, coords.length - 1);
  return next === best ? null : bearingTo(coords[best], coords[next]);
}

export const NativeMap = forwardRef<MapCameraHandle, NativeMapProps>(function NativeMapWeb(
  { userPosition, destination, route, drivers, selectedDriverId },
  ref,
) {
  const { scheme, colors } = useAppTheme();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapInstance | null>(null);
  const libRef = useRef<MapLibre | null>(null);
  const driverMarkersRef = useRef<Map<string, { el: HTMLDivElement; marker: MarkerInstance }>>(
    new Map(),
  );

  const [viewMode, setViewMode] = useState<MapViewMode>('2d');
  const [following, setFollowing] = useState(false);

  /** Lus par la caméra au moment où elle bouge, jamais dans le rendu. */
  const routeRef = useRef<[number, number][]>([]);
  routeRef.current = route ? route.geometry.coordinates : [];
  const userRef = useRef<[number, number] | null>(null);
  userRef.current = userPosition ? [userPosition.lng, userPosition.lat] : null;
  const modeRef = useRef<MapViewMode>('2d');
  modeRef.current = viewMode;
  const followingRef = useRef(false);
  followingRef.current = following;

  const accentRef = useRef(colors.surfaceStrong);
  accentRef.current = colors.surfaceStrong;

  /** Recadre sur l'utilisateur, orienté dans le sens de la marche. */
  const follow = useCallback(() => {
    const map = mapRef.current;
    const ll = userRef.current;
    if (!map || !ll || modeRef.current !== '3d' || !followingRef.current) return;

    const bearing = routeBearing(routeRef.current, ll);
    map.easeTo({
      center: ll,
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      pitch: PITCH_3D,
      bearing: bearing ?? map.getBearing(),
      duration: 900,
    });
  }, []);

  /**
   * Bâtiments extrudés. La source est repérée par sa couche : les styles clair
   * et sombre ne la nomment pas forcément pareil, et les tuiles de
   * démonstration n'en ont pas — la 3D reste alors inclinée, sans relief.
   */
  const setBuildings = useCallback((on: boolean) => {
    const map = mapRef.current;
    if (!map) return;

    const paint = () => {
      const existing = map.getLayer(BUILDING_LAYER);
      if (!on) {
        if (existing) map.removeLayer(BUILDING_LAYER);
        return;
      }
      if (existing) return;

      const layers = map.getStyle()?.layers ?? [];
      const source = layers.find((l) => l['source-layer'] === 'building' && l.source)?.source;
      if (!source) return;

      map.addLayer(
        {
          id: BUILDING_LAYER,
          source,
          'source-layer': 'building',
          type: 'fill-extrusion',
          minzoom: 14,
          paint: {
            'fill-extrusion-color': accentRef.current,
            'fill-extrusion-height': ['coalesce', ['get', 'render_height'], ['get', 'height'], 10],
            'fill-extrusion-base': [
              'coalesce',
              ['get', 'render_min_height'],
              ['get', 'min_height'],
              0,
            ],
            'fill-extrusion-opacity': 0.9,
          },
        },
        layers.find((l) => l.type === 'symbol')?.id,
      );
    };

    if (map.isStyleLoaded()) paint();
    else map.once('idle', paint);
  }, []);

  /** Voir `MapControls` : en 3D décrochée, le premier appui recentre. */
  const toggleView = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;

    if (viewMode === '2d') {
      setViewMode('3d');
      modeRef.current = '3d';
      setFollowing(true);
      followingRef.current = true;
      map.dragRotate.enable();
      map.touchPitch.enable();
      setBuildings(true);
      if (userRef.current) follow();
      else map.easeTo({ pitch: PITCH_3D, duration: 700 });
      return;
    }

    if (!following) {
      setFollowing(true);
      followingRef.current = true;
      follow();
      return;
    }

    setViewMode('2d');
    modeRef.current = '2d';
    setFollowing(false);
    followingRef.current = false;
    map.dragRotate.disable();
    map.touchPitch.disable();
    setBuildings(false);
    map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  }, [follow, following, setBuildings, viewMode]);

  // La caméra suit chaque nouveau point tant qu'on ne l'a pas déplacée à la main.
  useEffect(() => {
    follow();
  }, [follow, userPosition]);

  /* --- Simulation de trajet ---------------------------------------------- */

  const [simState, setSimState] = useState<MapSimState>('idle');
  const [simRemainingS, setSimRemainingS] = useState(0);
  const simRef = useRef<{
    plan: SimPlan;
    /** Origine des temps, reculée de l'avancement déjà fait à chaque reprise. */
    startedAt: number;
    /** Avancement figé par la pause, en secondes. */
    elapsed: number;
    paused: boolean;
    raf: number;
    marker: MarkerInstance;
    zoom: number;
    lastPost: number;
    /** Tracé d'origine, rendu tel quel à la fin de la simulation. */
    fullRoute: [number, number][];
  } | null>(null);

  const paintRoute = useCallback((coords: [number, number][]) => {
    const source = mapRef.current?.getSource('route');
    source?.setData({
      type: 'Feature',
      properties: {},
      geometry: { type: 'LineString', coordinates: coords },
    });
  }, []);

  /**
   * N'affiche que ce qu'il reste à parcourir : la portion déjà faite disparaît
   * derrière le véhicule, comme sur les applications de course.
   */
  const drawRemaining = useCallback(
    (sample: SimSample, plan: SimPlan) => {
      paintRoute([[sample.lng, sample.lat], ...plan.points.slice(sample.i + 1)]);
    },
    [paintRoute],
  );

  /** Range tout et rend son tracé complet à l'itinéraire. */
  const clearSimulation = useCallback(
    (finished: boolean) => {
      const sim = simRef.current;
      // Rien en cours : un arrêt à vide ne doit pas bouger la caméra, l'écran
      // en déclenche un à chaque nouvel itinéraire.
      if (!sim) return;

      cancelAnimationFrame(sim.raf);
      sim.marker.remove();
      simRef.current = null;

      paintRoute(sim.fullRoute);
      setSimState('idle');
      setSimRemainingS(0);

      // La caméra tournée dans le sens de la marche n'a plus lieu d'être.
      if (modeRef.current === '2d') mapRef.current?.easeTo({ bearing: 0, pitch: 0, duration: 500 });
    },
    [paintRoute],
  );

  const step = useCallback(
    (ts: number) => {
      const sim = simRef.current;
      const map = mapRef.current;
      if (!sim || sim.paused || !map) return;

      const s = sampleSimulation(sim.plan, (ts - sim.startedAt) / 1000);
      sim.marker.setLngLat([s.lng, s.lat]).setRotation(s.bearing);
      drawRemaining(s, sim.plan);

      // `jumpTo` et non `easeTo` : à 60 images par seconde, une animation par
      // image se battrait avec la précédente et donnerait une caméra molle.
      map.jumpTo({
        center: [s.lng, s.lat],
        bearing: s.bearing,
        pitch: modeRef.current === '3d' ? PITCH_3D : 0,
        zoom: sim.zoom,
      });

      if (ts - sim.lastPost > 500) {
        sim.lastPost = ts;
        setSimRemainingS(s.remainingS);
      }

      if (s.done) {
        clearSimulation(true);
        return;
      }
      sim.raf = requestAnimationFrame(step);
    },
    [clearSimulation, drawRemaining],
  );

  /**
   * Parcourt l'itinéraire à la vitesse moyenne estimée pour lui, en
   * ralentissant dans les virages et en marquant l'arrêt aux changements de
   * direction francs. Le profil vient du module partagé avec la carte native.
   *
   * Trois états sur un bouton : lancer, mettre en pause, reprendre — la reprise
   * repart de l'endroit atteint, jamais du départ.
   */
  const toggleSimulation = useCallback(() => {
    const sim = simRef.current;

    if (sim && !sim.paused) {
      cancelAnimationFrame(sim.raf);
      sim.raf = 0;
      sim.elapsed = (performance.now() - sim.startedAt) / 1000;
      sim.paused = true;
      setSimState('paused');
      setSimRemainingS(sampleSimulation(sim.plan, sim.elapsed).remainingS);
      return;
    }

    if (sim && sim.paused) {
      sim.paused = false;
      // L'origine des temps est reculée de ce qui a déjà été parcouru : la
      // lecture retombe exactement sur l'image où la pause l'avait laissée.
      sim.startedAt = performance.now() - sim.elapsed * 1000;
      setSimState('running');
      sim.raf = requestAnimationFrame(step);
      return;
    }

    const map = mapRef.current;
    const lib = libRef.current;
    if (!map || !lib || !route) return;

    const plan = planSimulation(route.geometry.coordinates, averageSpeedKmh(route));
    if (!plan) return;

    // Le suivi de la position réelle et la simulation viseraient la même caméra.
    setFollowing(false);

    const el = document.createElement('div');
    el.style.cssText = [
      'display:flex',
      'align-items:center',
      'justify-content:center',
      'width:34px',
      'height:34px',
      'border-radius:17px',
      `background:${colors.surfaceAlt}`,
      `border:2px solid ${colors.accent}`,
      `box-shadow:0 0 0 6px ${colors.accentSoft}`,
    ].join(';');
    el.innerHTML = carIconSvg(colors.accent);

    const first = plan.frames[0];
    simRef.current = {
      plan,
      startedAt: performance.now(),
      elapsed: 0,
      paused: false,
      raf: 0,
      marker: new lib.Marker({ element: el, rotationAlignment: 'map' })
        .setLngLat([first.lng, first.lat])
        .addTo(map),
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      lastPost: 0,
      fullRoute: routeRef.current,
    };

    // Le tracé planifié remplace celui qui est affiché : sans cela, les indices
    // des images ne désigneraient pas les mêmes sommets.
    paintRoute(plan.points);
    setSimState('running');
    setSimRemainingS(plan.durationS);
    simRef.current.raf = requestAnimationFrame(step);
  }, [colors, paintRoute, route, step]);

  // Un nouvel itinéraire périme la simulation en cours, et démonter l'écran
  // laisserait une boucle d'animation tourner dans le vide.
  useEffect(() => () => clearSimulation(false), [clearSimulation, route]);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom = FIRST_FIX_ZOOM) {
      mapRef.current?.flyTo({ center: [lng, lat], zoom, duration: 900 });
    },
    fitRoute(coords) {
      if (!mapRef.current || coords.length < 2) return;
      // Cadrer tout le trajet et rester incliné se contredisent.
      setFollowing(false);
      const lngs = coords.map((c) => c[0]);
      const lats = coords.map((c) => c[1]);
      mapRef.current.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        { padding: 80, duration: 800, maxZoom: 16, pitch: 0 },
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
      // Vue à plat par défaut, comme la carte native : la 3D s'active au bouton.
      map.dragRotate.disable();
      map.touchPitch.disable();
      // Prendre la carte en main coupe le suivi : la caméra ne doit pas se
      // battre avec la souris.
      map.on('dragstart', () => setFollowing(false));
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
      // Une simulation en cours tient le tracé, dont elle efface la portion
      // déjà parcourue : le repeindre entier le ferait réapparaître.
      if (simRef.current) return;
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
      <MapControls
        mode={viewMode}
        following={following}
        onToggleView={toggleView}
        canSimulate={!!route && route.geometry.coordinates.length > 1}
        simState={simState}
        simRemainingS={simRemainingS}
        onToggleSim={toggleSimulation}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
