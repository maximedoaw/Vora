import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import { CarFront, ChevronLeft, ChevronRight, MapPin } from 'lucide-react-native';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatStamp } from '@/lib/datetime';
import { rideStatusColor, rideStatusLabel, rideStatusTint } from '@/lib/rides';
import { api } from '../../convex/_generated/api';

/**
 * Historique des courses, identique pour les deux rôles et tous statuts
 * confondus : un passager y retrouve ses trajets, un chauffeur ses prises en
 * charge. Chaque ligne rouvre le suivi de la course.
 */
export default function RidesScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const rides = useQuery(api.rides.listMine, {});

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          hitSlop={10}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
          <ChevronLeft size={26} color={colors.text} />
        </Pressable>
        <Text style={styles.headerTitle}>Mes courses</Text>
      </View>

      {rides === undefined ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : rides.length === 0 ? (
        <View style={styles.emptyWrap}>
          <CarFront size={40} color={colors.textMuted} />
          <Text style={styles.empty}>Aucune course pour le moment.</Text>
          <Text style={styles.emptyHint}>
            Une course naît quand un passager partage sa position dans une discussion et qu&apos;un
            chauffeur l&apos;accepte.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}>
          {rides.map((ride) => {
            const color = rideStatusColor(ride.status, colors);

            return (
              <Pressable
                key={ride.id}
                accessibilityRole="button"
                accessibilityLabel={`Course avec ${ride.counterpart}, ${rideStatusLabel(ride.status, ride.asDriver)}`}
                onPress={() =>
                  router.push({ pathname: '/ride/[rideId]', params: { rideId: ride.id } })
                }
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
                <View style={[styles.icon, { backgroundColor: rideStatusTint(ride.status, colors) }]}>
                  <MapPin size={18} color={color} />
                </View>

                <View style={styles.texts}>
                  <Text style={styles.name} numberOfLines={1}>
                    {ride.counterpart}
                  </Text>
                  <Text style={styles.place} numberOfLines={1}>
                    {ride.pickupName ?? 'Position partagée'}
                  </Text>
                  <View style={styles.metaRow}>
                    <View style={[styles.pill, { backgroundColor: rideStatusTint(ride.status, colors) }]}>
                      <Text style={[styles.pillLabel, { color }]}>
                        {rideStatusLabel(ride.status, ride.asDriver)}
                      </Text>
                    </View>
                    <Text style={styles.role}>{ride.asDriver ? 'Chauffeur' : 'Passager'}</Text>
                  </View>
                </View>

                <View style={styles.right}>
                  <Text style={styles.stamp}>{formatStamp(ride.requestedAt)}</Text>
                  <ChevronRight size={18} color={colors.textMuted} />
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: c.divider,
      backgroundColor: c.surfaceAlt,
    },
    back: {
      width: 32,
      height: 32,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      color: c.text,
      fontSize: 16,
      fontWeight: '800',
    },
    loader: {
      marginTop: 40,
    },
    emptyWrap: {
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 40,
      marginTop: 64,
    },
    empty: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
    },
    emptyHint: {
      color: c.textMuted,
      fontSize: 13,
      lineHeight: 18,
      textAlign: 'center',
    },
    list: {
      paddingHorizontal: 12,
      paddingTop: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 8,
      paddingVertical: 12,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: c.divider,
    },
    icon: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
    },
    texts: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    name: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
    },
    place: {
      color: c.textMuted,
      fontSize: 12,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      marginTop: 2,
    },
    pill: {
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    pillLabel: {
      fontSize: 10,
      fontWeight: '800',
    },
    role: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '600',
    },
    right: {
      alignItems: 'flex-end',
      gap: 6,
    },
    stamp: {
      color: c.textMuted,
      fontSize: 11,
    },
    pressed: {
      opacity: 0.75,
    },
  });
