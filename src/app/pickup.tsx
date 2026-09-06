import { router, useLocalSearchParams } from 'expo-router';
import { ChevronLeft, Clock, MapPin, Route as RouteIcon } from 'lucide-react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useGeo } from '@/hooks/use-geo';
import { NativeMap } from '@/components/map/native-map';
import type { MapCameraHandle } from '@/components/map/native-map-shared';
import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useRoute } from '@/hooks/use-route';
import { useSettledOrigin } from '@/hooks/use-settled-origin';
import { formatDistance, formatDuration } from '@/lib/geo-utils';
import { reverseGeocode, type GeocodeFeature } from '@/lib/geocoding';
import { FIRST_FIX_ZOOM } from '@/lib/map';
import type { LngLat } from '@/lib/routing';

function parseCoord(value: string | undefined, max: number): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || Math.abs(parsed) > max) return null;
  return parsed;
}

/**
 * Itinéraire vers une position partagée dans une discussion : le chauffeur y voit
 * le chemin, la distance, le temps de trajet et le nom du lieu pour rejoindre son
 * client. Écran en lecture seule — il ne modifie rien.
 */
export default function PickupScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapCameraHandle>(null);
  const geo = useGeo();

  const { lat, lng, label, who } = useLocalSearchParams<{
    lat: string;
    lng: string;
    label?: string;
    who?: string;
  }>();

  const target = useMemo<LngLat | null>(() => {
    const parsedLat = parseCoord(lat, 90);
    const parsedLng = parseCoord(lng, 180);
    return parsedLat != null && parsedLng != null ? [parsedLng, parsedLat] : null;
  }, [lat, lng]);

  /** Le libellé transmis peut manquer (géocodage indisponible à l'envoi). */
  const [placeName, setPlaceName] = useState(label?.trim() ?? '');

  useEffect(() => {
    if (placeName || !target) return;

    const controller = new AbortController();
    void reverseGeocode(target, { signal: controller.signal })
      .then((place) => {
        if (controller.signal.aborted || !place) return;
        setPlaceName(place.place_name || place.text);
      })
      .catch(() => {
        /* le lieu restera « Lieu inconnu » */
      });

    return () => controller.abort();
  }, [placeName, target]);

  /**
   * Le trajet se rafraîchit tous les 300 m parcourus, pas à chaque point GPS :
   * l'estimation reste utile en approchant sans marteler le service de routage.
   */
  const origin = useSettledOrigin(geo.position?.lng, geo.position?.lat, 300);
  const { route, status } = useRoute(origin, target);

  const destination = useMemo<GeocodeFeature | null>(
    () =>
      target
        ? {
            id: `pickup:${target[0]},${target[1]}`,
            text: placeName || 'Position partagée',
            place_name: placeName || 'Position partagée',
            center: target,
            source: 'photon',
          }
        : null,
    [placeName, target],
  );

  // Cadrage sur l'itinéraire complet dès qu'il est disponible, une seule fois.
  const fitted = useRef(false);
  useEffect(() => {
    if (!route || fitted.current) return;
    fitted.current = true;
    mapRef.current?.fitRoute(route.geometry.coordinates);
  }, [route]);

  useEffect(() => {
    if (route || !target) return;
    mapRef.current?.flyTo(target[0], target[1], FIRST_FIX_ZOOM);
  }, [route, target]);

  const title = who?.trim() ? `Rejoindre ${who.trim()}` : 'Point de rendez-vous';

  return (
    <View style={styles.root}>
      <NativeMap
        ref={mapRef}
        userPosition={geo.position}
        destination={destination}
        route={route}
      />

      <View
        pointerEvents="box-none"
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + 8,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: 16,
          },
        ]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retour"
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>

        <View style={styles.card}>
          {!target ? (
            <Text style={styles.error}>Position partagée illisible.</Text>
          ) : (
            <>
              <View style={styles.place}>
                <View style={styles.placeIcon}>
                  <MapPin size={18} color={colors.accent} />
                </View>
                <View style={styles.placeTexts}>
                  <Text style={styles.placeName} numberOfLines={2}>
                    {placeName || 'Lieu inconnu'}
                  </Text>
                  <Text style={styles.coords}>
                    {target[1].toFixed(5)}, {target[0].toFixed(5)}
                  </Text>
                </View>
              </View>

              {!geo.position ? (
                <Text style={styles.meta}>
                  Active ta localisation pour calculer le trajet jusqu&apos;à ce point.
                </Text>
              ) : status === 'loading' && !route ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={colors.accent} size="small" />
                  <Text style={styles.meta}>Calcul du trajet…</Text>
                </View>
              ) : route ? (
                <>
                  <View style={styles.stats}>
                    <View style={styles.stat}>
                      <RouteIcon size={16} color={colors.textSecondary} />
                      <Text style={styles.statValue}>
                        {formatDistance(route.distanceM / 1000)}
                      </Text>
                      <Text style={styles.statLabel}>distance</Text>
                    </View>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                      <Clock size={16} color={colors.textSecondary} />
                      <Text style={styles.statValue}>{formatDuration(route.durationS)}</Text>
                      <Text style={styles.statLabel}>trajet</Text>
                    </View>
                  </View>

                  {route.source === 'estimate' ? (
                    <View style={styles.warning}>
                      <Text style={styles.warningText}>
                        Tracé approximatif (vol d&apos;oiseau) — routage indisponible
                        {route.error ? ` : ${route.error}` : ''}
                      </Text>
                    </View>
                  ) : null}
                </>
              ) : null}
            </>
          )}
        </View>
      </View>
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      paddingRight: 14,
      paddingVertical: 6,
    },
    back: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      flexShrink: 1,
    },
    card: {
      marginTop: 'auto',
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    place: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    placeIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    placeTexts: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    placeName: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20,
    },
    coords: {
      color: c.textMuted,
      fontSize: 11,
    },
    stats: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceMuted,
      borderRadius: 14,
      paddingVertical: 10,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: c.border,
    },
    statValue: {
      color: c.text,
      fontSize: 16,
      fontWeight: '800',
    },
    statLabel: {
      color: c.textMuted,
      fontSize: 11,
    },
    loadingRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    meta: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
      flexShrink: 1,
    },
    error: {
      color: c.danger,
      fontSize: 14,
    },
    warning: {
      backgroundColor: c.warningBg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.warningBorder,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    warningText: {
      color: c.warning,
      fontSize: 12,
      lineHeight: 17,
    },
    pressed: {
      opacity: 0.75,
    },
  });
