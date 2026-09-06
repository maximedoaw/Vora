import { ChevronDown, ChevronRight } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import type { RideDriver } from '@/lib/drivers';
import { formatDistance } from '@/lib/geo-utils';
import type { RouteResult } from '@/lib/routing';
import { estimateFare, formatXaf, resolveVehicleType } from '@/lib/vehicles';

type Props = {
  drivers: RideDriver[];
  loading: boolean;
  /** Itinéraire courant : sert à chiffrer la course pour chaque véhicule. */
  route: RouteResult | null;
  selectedId: string | null;
  onSelect: (driver: RideDriver) => void;
  /** Ouvre la discussion dédiée avec ce chauffeur. */
  onMessage: (driver: RideDriver) => void;
};

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?';
}

function ratingLabel(rating: number | null) {
  return rating == null ? 'Nouveau' : `★ ${rating.toFixed(1).replace('.', ',')}`;
}

/**
 * Chauffeurs proposés au passager : profils Convex puis profils de test.
 * À monter uniquement pour un profil `rider`.
 */
export function DriverSuggestions({
  drivers,
  loading,
  route,
  selectedId,
  onSelect,
  onMessage,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [open, setOpen] = useState(true);
  const tripKm = route ? route.distanceM / 1000 : null;
  const tripMin = route ? route.durationS / 60 : null;
  const hasDemo = drivers.some((driver) => driver.demo);
  const selected = drivers.find((driver) => driver.id === selectedId) ?? null;

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'Replier la liste des chauffeurs' : 'Déplier la liste des chauffeurs'}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.header, pressed && styles.pressed]}>
        {/* Replié, l'en-tête rappelle qui est retenu — sinon on perd le fil. */}
        <Text style={styles.title} numberOfLines={1}>
          {!open && selected ? selected.name : 'Chauffeurs suggérés'}
        </Text>
        <View style={styles.headerRight}>
          {loading ? (
            <ActivityIndicator color={colors.accent} size="small" />
          ) : (
            <Text style={styles.count}>{drivers.length}</Text>
          )}
          {open ? (
            <ChevronDown size={18} color={colors.textSecondary} />
          ) : (
            <ChevronRight size={18} color={colors.textSecondary} />
          )}
        </View>
      </Pressable>

      {!open ? null : loading && drivers.length === 0 ? (
        <Text style={styles.meta}>Recherche des chauffeurs…</Text>
      ) : drivers.length === 0 ? (
        <Text style={styles.meta}>Aucun chauffeur disponible pour le moment.</Text>
      ) : (
        <ScrollView
          style={styles.list}
          contentContainerStyle={styles.listContent}
          nestedScrollEnabled
          keyboardShouldPersistTaps="handled">
          {drivers.map((driver) => {
            const type = resolveVehicleType(driver.vehicle?.type ?? '');
            const fare =
              tripKm != null && tripMin != null ? estimateFare(type, tripKm, tripMin) : null;
            const away = driver.distanceKm;
            const selected = driver.id === selectedId;

            return (
              <Pressable
                key={driver.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => {
                  // Choisir, c'est avoir fini de chercher : la liste se replie
                  // et laisse la carte et le bouton vert au premier plan.
                  if (driver.id !== selectedId) setOpen(false);
                  onSelect(driver);
                }}
                style={({ pressed }) => [
                  styles.row,
                  selected && styles.rowSelected,
                  !driver.isAvailable && styles.rowBusy,
                  pressed && styles.pressed,
                ]}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarLabel}>{initial(driver.name)}</Text>
                </View>

                <View style={styles.texts}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name} numberOfLines={1}>
                      {driver.name}
                    </Text>
                    <View
                      style={[styles.dot, driver.isAvailable ? styles.dotFree : styles.dotBusy]}
                    />
                    {driver.demo ? (
                      <View style={styles.badge}>
                        <Text style={styles.badgeLabel}>TEST</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={styles.sub} numberOfLines={1}>
                    {driver.isAvailable ? 'Disponible' : 'Indisponible'}
                    {` · ${type.label}`}
                    {away != null ? ` · à ${formatDistance(away)}` : ''}
                  </Text>
                </View>

                <View style={styles.right}>
                  {fare != null ? <Text style={styles.fare}>{formatXaf(fare)}</Text> : null}
                  <Text style={styles.rating}>{ratingLabel(driver.rating)}</Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {open && hasDemo ? (
        <Text style={styles.note}>
          Les 5 profils « TEST » sont des chauffeurs fictifs placés autour de toi : ils servent à
          essayer la demande de confirmation de course.
        </Text>
      ) : null}

      {/* Hors du ScrollView : le bouton reste visible quoi qu'on fasse défiler. */}
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !selected }}
        accessibilityLabel={
          selected ? `Discuter avec ${selected.name}` : 'Sélectionne un chauffeur pour discuter'
        }
        disabled={!selected}
        onPress={() => selected && onMessage(selected)}
        style={({ pressed }) => [
          styles.cta,
          !selected && styles.ctaDisabled,
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.ctaLabel, !selected && styles.ctaLabelDisabled]}>
          {selected ? `Discuter avec ${selected.name.split(' ')[0]}` : 'Sélectionne un chauffeur'}
        </Text>
      </Pressable>
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
      paddingHorizontal: 12,
      paddingVertical: 12,
      gap: 8,
      marginBottom: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 4,
      paddingVertical: 2,
    },
    headerRight: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    count: {
      color: c.textMuted,
      fontSize: 12,
      fontWeight: '700',
    },
    cta: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.accent,
      borderRadius: 14,
      height: 46,
      marginTop: 2,
    },
    ctaDisabled: {
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
    },
    ctaLabel: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: '800',
    },
    ctaLabelDisabled: {
      color: c.textMuted,
    },
    title: {
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
    },
    meta: {
      color: c.textSecondary,
      fontSize: 13,
      paddingHorizontal: 4,
      paddingVertical: 6,
    },
    note: {
      color: c.textMuted,
      fontSize: 11,
      lineHeight: 15,
      paddingHorizontal: 4,
    },
    list: {
      maxHeight: 196,
    },
    listContent: {
      gap: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: 'transparent',
      paddingHorizontal: 8,
      paddingVertical: 8,
    },
    rowSelected: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    rowBusy: {
      opacity: 0.62,
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
    },
    dotFree: {
      backgroundColor: c.accent,
    },
    dotBusy: {
      backgroundColor: c.textMuted,
    },
    pressed: {
      opacity: 0.75,
    },
    avatar: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.surfaceStrong,
      borderWidth: 1,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarLabel: {
      color: c.accent,
      fontSize: 16,
      fontWeight: '800',
    },
    texts: {
      flex: 1,
      minWidth: 0,
    },
    nameRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    name: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
      flexShrink: 1,
    },
    badge: {
      backgroundColor: c.warningBg,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: c.warningBorder,
      paddingHorizontal: 5,
      paddingVertical: 1,
    },
    badgeLabel: {
      color: c.warning,
      fontSize: 9,
      fontWeight: '800',
      letterSpacing: 0.5,
    },
    sub: {
      color: c.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    right: {
      alignItems: 'flex-end',
    },
    fare: {
      color: c.accent,
      fontSize: 14,
      fontWeight: '800',
    },
    rating: {
      color: c.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
  });
