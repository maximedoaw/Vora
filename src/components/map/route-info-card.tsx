import { X } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

import { formatDistance, formatDuration } from '@/lib/geo-utils';
import type { RouteResult } from '@/lib/routing';
import { estimateFare, formatXaf, VEHICLE_TYPES, type VehicleType } from '@/lib/vehicles';

type Props = {
  route: RouteResult | null;
  loading: boolean;
  onClear: () => void;
  /** Véhicule sur lequel chiffrer le prix affiché — celui du chauffeur choisi. */
  vehicle?: VehicleType | null;
  /** Grille par classe de véhicule : masquée dès qu'un prix par chauffeur est listé. */
  showFareChips?: boolean;
};

const DEFAULT_VEHICLE = VEHICLE_TYPES.find((v) => v.id === 'berline')!;

export function RouteInfoCard({
  route,
  loading,
  onClear,
  vehicle,
  showFareChips = true,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const tripKm = route ? route.distanceM / 1000 : null;
  const tripMin = route ? route.durationS / 60 : null;
  const priced = vehicle ?? DEFAULT_VEHICLE;
  const fare = tripKm != null && tripMin != null ? estimateFare(priced, tripKm, tripMin) : null;

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {route && fare != null ? (
          <View style={styles.stats}>
            <Text style={styles.price}>{formatXaf(fare)}</Text>
            <Text style={styles.meta}>
              {formatDuration(route.durationS)} · {formatDistance(tripKm!)}
              {vehicle ? ` · ${vehicle.label}` : ''}
            </Text>
          </View>
        ) : (
          <Text style={styles.loading}>
            {loading ? "Calcul de l'itinéraire…" : '—'}
          </Text>
        )}
        <Pressable onPress={onClear} hitSlop={12} style={styles.close}>
          <X size={15} color={colors.textSecondary} />
        </Pressable>
      </View>

      {route?.source === 'estimate' ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Tracé approximatif (vol d’oiseau) — routage indisponible
            {route.error ? ` : ${route.error}` : ''}
          </Text>
        </View>
      ) : null}

      {showFareChips && route && tripKm != null && tripMin != null ? (
        <View style={styles.fares}>
          {VEHICLE_TYPES.map((type) => (
            <View key={type.id} style={styles.fareChip}>
              <Text style={styles.fareLabel}>{type.label}</Text>
              <Text style={styles.fareValue}>{formatXaf(estimateFare(type, tripKm, tripMin))}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    card: {
      alignSelf: 'stretch',
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    top: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 12,
    },
    stats: {
      flex: 1,
      gap: 2,
    },
    price: {
      color: c.text,
      fontSize: 22,
      fontWeight: '800',
    },
    meta: {
      color: c.textSecondary,
      fontSize: 13,
    },
    loading: {
      flex: 1,
      color: c.textSecondary,
      fontSize: 15,
    },
    close: {
      width: 32,
      height: 32,
      borderRadius: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceMuted,
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
    fares: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    fareChip: {
      backgroundColor: c.surfaceAlt,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 10,
      paddingVertical: 8,
      minWidth: '46%',
      flexGrow: 1,
    },
    fareLabel: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    fareValue: {
      color: c.accent,
      fontSize: 13,
      fontWeight: '800',
      marginTop: 2,
    },
  });
