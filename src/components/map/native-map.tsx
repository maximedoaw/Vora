import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { mapLibreHtml } from '@/components/map/map-html';
import {
  FIRST_FIX_ZOOM,
  type MapCameraHandle,
  type NativeMapProps,
} from '@/components/map/native-map-shared';
import { useAppTheme } from '@/hooks/use-app-theme';
import { downsampleCoords } from '@/lib/geo-utils';

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
    };

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

  const send = useCallback((msg: MapMsg) => {
    if (msg.type !== 'flyTo' && msg.type !== 'fitRoute') latestRef.current[msg.type] = msg;
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

  const onMessage = (event: WebViewMessageEvent) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as { type?: string };
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
