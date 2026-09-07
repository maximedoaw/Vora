import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { MapControls } from '@/components/map/map-controls';
import { mapLibreHtml } from '@/components/map/map-html';
import {
  FIRST_FIX_ZOOM,
  type MapCameraHandle,
  type MapSimState,
  type MapViewMode,
  type NativeMapProps,
} from '@/components/map/native-map-shared';
import { useAppTheme } from '@/hooks/use-app-theme';
import { downsampleCoords } from '@/lib/geo-utils';
import { averageSpeedKmh, planSimulation, type SimFrame } from '@/lib/route-sim';

type MapMsg =
  | { type: 'flyTo'; lng: number; lat: number; zoom: number }
  | { type: 'fitRoute'; coords: [number, number][] }
  | { type: 'user'; lng: number; lat: number }
  | { type: 'destination'; center: [number, number] | null }
  | { type: 'route'; coords: [number, number][] }
  | {
      type: 'drivers';
      items: {
        id: string;
        label: string;
        center: [number, number];
        demo: boolean;
        available: boolean;
        selected: boolean;
      }[];
    }
  | { type: 'view'; mode: MapViewMode }
  | { type: 'recenter' }
  | {
      type: 'simulate';
      action: 'start';
      frames: SimFrame[];
      points: [number, number][];
      durationS: number;
    }
  | { type: 'simulate'; action: 'pause' | 'resume' | 'stop' };

/**
 * Les images de simulation traversent le pont React Native → WebView en JSON :
 * six décimales suffisent à placer un point au décimètre, et alléger la charge
 * utile compte quand elle fait plusieurs milliers d'éléments.
 */
function trimFrames(frames: SimFrame[]): SimFrame[] {
  return frames.map((frame) => ({
    t: Math.round(frame.t * 100) / 100,
    lng: round6(frame.lng),
    lat: round6(frame.lat),
    bearing: Math.round(frame.bearing * 10) / 10,
    i: frame.i,
  }));
}

const round6 = (value: number) => Math.round(value * 1e6) / 1e6;

function trimPoints(points: [number, number][]): [number, number][] {
  return points.map(([lng, lat]) => [round6(lng), round6(lat)]);
}

export const NativeMap = forwardRef<MapCameraHandle, NativeMapProps>(function NativeMap(
  { userPosition, destination, route, drivers, selectedDriverId },
  ref,
) {
  const { scheme, colors } = useAppTheme();
  const webRef = useRef<WebView>(null);
  const readyRef = useRef(false);
  const queueRef = useRef<MapMsg[]>([]);
  /** Dernier état connu par type : rejoué tel quel après un rechargement (thème). */
  const latestRef = useRef<Partial<Record<MapMsg['type'], MapMsg>>>({});
  const html = useMemo(() => mapLibreHtml(scheme), [scheme]);
  const [tilesReady, setTilesReady] = useState(false);
  const [viewMode, setViewMode] = useState<MapViewMode>('2d');
  /** `true` quand la caméra suit encore l'utilisateur — coupé dès qu'on déplace la carte. */
  const [following, setFollowing] = useState(false);
  const [simState, setSimState] = useState<MapSimState>('idle');
  const [simRemainingS, setSimRemainingS] = useState(0);

  const send = useCallback((msg: MapMsg) => {
    // Les ordres ponctuels ne sont pas rejoués après un rechargement : seul
    // l'état durable de la carte l'est, dont le mode de vue.
    const oneShot =
      msg.type === 'flyTo' ||
      msg.type === 'fitRoute' ||
      msg.type === 'recenter' ||
      msg.type === 'simulate';
    if (!oneShot) latestRef.current[msg.type] = msg;
    if (!readyRef.current) {
      queueRef.current.push(msg);
      return;
    }
    webRef.current?.injectJavaScript(
      `window.__vora && window.__vora(${JSON.stringify(msg)}); true;`,
    );
  }, []);

  // Changer de thème régénère le HTML : la WebView recharge, tout est à refaire.
  useEffect(() => {
    readyRef.current = false;
    queueRef.current = [];
    setTilesReady(false);
  }, [html]);

  const resize = useCallback(() => {
    webRef.current?.injectJavaScript('window.__resize && window.__resize(); true;');
  }, []);

  useImperativeHandle(ref, () => ({
    flyTo(lng, lat, zoom = FIRST_FIX_ZOOM) {
      send({ type: 'flyTo', lng, lat, zoom });
    },
    fitRoute(coords) {
      send({ type: 'fitRoute', coords: downsampleCoords(coords, 600) });
    },
  }));

  /**
   * Bascule 2D ↔ 3D, avec une étape intermédiaire : en 3D, si la carte a été
   * déplacée à la main, le premier appui recentre au lieu de quitter la vue —
   * sortir de la 3D quand on voulait juste revenir sur soi serait une surprise.
   */
  const toggleView = useCallback(() => {
    if (viewMode === '2d') {
      setViewMode('3d');
      send({ type: 'view', mode: '3d' });
      return;
    }
    if (!following) {
      send({ type: 'recenter' });
      return;
    }
    setViewMode('2d');
    send({ type: 'view', mode: '2d' });
  }, [following, send, viewMode]);

  /**
   * Parcourt l'itinéraire à la vitesse moyenne que le service de routage a
   * estimée pour lui, en ralentissant dans les virages et en marquant l'arrêt
   * aux changements de direction francs.
   *
   * Le profil est calculé ici, pas dans la WebView : la carte web joue le même
   * plan, et une physique en double finirait par diverger.
   */
  const toggleSimulation = useCallback(() => {
    if (simState === 'running') {
      send({ type: 'simulate', action: 'pause' });
      return;
    }
    // En pause, on repart d'où le véhicule s'est arrêté, pas du départ.
    if (simState === 'paused') {
      send({ type: 'simulate', action: 'resume' });
      return;
    }
    if (!route) return;

    const plan = planSimulation(route.geometry.coordinates, averageSpeedKmh(route));
    if (!plan) return;

    setSimRemainingS(plan.durationS);
    send({
      type: 'simulate',
      action: 'start',
      frames: trimFrames(plan.frames),
      points: trimPoints(plan.points),
      durationS: plan.durationS,
    });
  }, [route, send, simState]);

  // Un nouvel itinéraire périme la simulation en cours : elle parcourrait un
  // tracé qui n'est plus à l'écran.
  useEffect(() => {
    send({ type: 'simulate', action: 'stop' });
  }, [route, send]);

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        on?: boolean;
        state?: MapSimState;
        remainingS?: number;
      };
      if (data.type === 'follow') {
        setFollowing(data.on === true);
        return;
      }
      if (data.type === 'sim') {
        setSimState(data.state ?? 'idle');
        setSimRemainingS(data.remainingS ?? 0);
        return;
      }
      if (data.type !== 'ready') return;
      readyRef.current = true;
      setTilesReady(true);
      const pending = [...Object.values(latestRef.current), ...queueRef.current] as MapMsg[];
      queueRef.current = [];
      pending.forEach(send);
      resize();
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!userPosition) return;
    send({ type: 'user', lng: userPosition.lng, lat: userPosition.lat });
  }, [send, userPosition]);

  useEffect(() => {
    send({ type: 'destination', center: destination ? destination.center : null });
  }, [destination, send]);

  useEffect(() => {
    send({
      type: 'route',
      coords: route ? downsampleCoords(route.geometry.coordinates, 600) : [],
    });
  }, [route, send]);

  useEffect(() => {
    send({
      type: 'drivers',
      items: (drivers ?? []).map((driver) => ({
        id: driver.id,
        label: driver.label,
        center: driver.center,
        demo: driver.demo,
        available: driver.available,
        selected: driver.id === selectedDriverId,
      })),
    });
  }, [drivers, selectedDriverId, send]);

  return (
    <View style={[styles.wrap, { backgroundColor: colors.mapBackground }]} onLayout={resize}>
      <WebView
        ref={webRef}
        key={scheme}
        style={[styles.map, { backgroundColor: colors.mapBackground }]}
        originWhitelist={['*']}
        source={{ html, baseUrl: 'https://unpkg.com/' }}
        onMessage={onMessage}
        onLoadEnd={resize}
        javaScriptEnabled
        domStorageEnabled
        mixedContentMode="always"
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        overScrollMode="never"
      />
      {tilesReady ? (
        <MapControls
          mode={viewMode}
          following={following}
          onToggleView={toggleView}
          canSimulate={!!route && route.geometry.coordinates.length > 1}
          simState={simState}
          simRemainingS={simRemainingS}
          onToggleSim={toggleSimulation}
        />
      ) : null}

      {!tilesReady ? (
        <View pointerEvents="none" style={[styles.loader, { backgroundColor: colors.mapBackground }]}>
          <ActivityIndicator color={colors.accent} size="large" />
          <Text style={[styles.loaderText, { color: colors.textMuted }]}>
            Chargement de la carte…
          </Text>
        </View>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loader: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  loaderText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
