import { Check, Clock, UserPlus, Users } from 'lucide-react-native';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatDistance } from '@/lib/geo-utils';
import {
  formatSaving,
  MAIN_RIDER_ID,
  shareOf,
  type FareSplit,
} from '@/lib/shared-ride';
import { formatXaf } from '@/lib/vehicles';

/** Miroir côté app de `convex/sharing.ts` — évite d'importer le type généré ici. */
export type SharingCompanion = {
  id: string;
  name: string;
  demo: boolean;
  boardProgress: number;
  dropProgress: number;
  status: 'waiting' | 'onboard' | 'dropped' | 'cancelled';
};

export type SharingState = {
  enabled: boolean;
  sharedAt: number | null;
  seats: number;
  freeSeats: number;
  companions: SharingCompanion[];
};

type Props = {
  state: SharingState | null | undefined;
  /** Parts calculées par `splitSharedFare`, vides tant que l'itinéraire manque. */
  splits: FareSplit[];
  asDriver: boolean;
  /** `false` quand la course n'a pas de destination : rien à partager. */
  shareable: boolean;
  /** Longueur de l'itinéraire, pour situer les montées et descentes. */
  routeKm: number | null;
  /** Délai d'attente avant la recherche de passagers, en millisecondes. */
  searchDelayMs: number;
  busy: boolean;
  onToggle: (enabled: boolean) => void;
  onBoard: (companionId: string) => void;
  onDrop: (companionId: string) => void;
};

const STATUS_LABEL: Record<SharingCompanion['status'], string> = {
  waiting: 'À récupérer',
  onboard: 'À bord',
  dropped: 'Déposé',
  cancelled: 'Annulé',
};

/** Ré-affiche le compte à rebours sans marteler le rendu. */
const TICK_MS = 10_000;

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [active]);

  return now;
}

/**
 * Carte « Trajet partagé ».
 *
 * Côté passager : ouvrir sa course, suivre qui monte, et voir sa part fondre à
 * mesure que le véhicule se remplit. Côté chauffeur : la liste des montées et
 * des descentes, dans l'ordre où elles se présentent sur la route.
 */
export function SharedRide({
  state,
  splits,
  asDriver,
  shareable,
  routeKm,
  searchDelayMs,
  busy,
  onToggle,
  onBoard,
  onDrop,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  /**
   * La recherche est déduite ici, et non renvoyée par le serveur : une requête
   * Convex ne se relance pas au passage du temps, l'indicateur resterait donc
   * affiché indéfiniment si personne ne montait. Le tic local, lui, périme
   * l'attente tout seul.
   */
  const pending = state?.enabled === true && state.companions.length === 0;
  const now = useNow(pending);
  const searching =
    pending && state?.sharedAt != null && now - state.sharedAt < searchDelayMs;

  const mine = shareOf(splits, MAIN_RIDER_ID);
  const saving = mine ? formatSaving(mine.savedRatio) : null;

  /** Minutes restantes avant l'arrivée des premiers passagers, au plus près. */
  const minutesLeft = useMemo(() => {
    if (!searching || !state?.sharedAt) return null;
    const remaining = state.sharedAt + searchDelayMs - now;
    return remaining > 0 ? Math.ceil(remaining / 60_000) : null;
  }, [now, searchDelayMs, searching, state?.sharedAt]);

  if (!state) return null;

  const companions = state.companions.filter((companion) => companion.status !== 'cancelled');

  /** Repère parlant : « monte à 2,4 km » plutôt qu'une fraction abstraite. */
  const atKm = (progress: number) =>
    routeKm != null ? formatDistance(progress * routeKm) : `${Math.round(progress * 100)} %`;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <View style={styles.headerIcon}>
          <Users size={16} color={colors.accent} />
        </View>
        <Text style={styles.title}>Trajet partagé</Text>
        {state.enabled ? (
          <Text style={styles.seats}>
            {state.freeSeats > 0
              ? `${state.freeSeats} place${state.freeSeats > 1 ? 's' : ''} libre${state.freeSeats > 1 ? 's' : ''}`
              : 'Complet'}
          </Text>
        ) : null}
      </View>

      {!state.enabled ? (
        <>
          <Text style={styles.body}>
            {shareable
              ? 'Accepte que d’autres personnes montent sur ton itinéraire. Chacun ne paie que les portions qu’il occupe : ta part baisse à chaque passager qui monte, et personne ne paie plus que son trajet seul.'
              : 'Le partage demande une destination : sans elle, impossible de savoir qui va dans la même direction.'}
          </Text>
          {!asDriver ? (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ disabled: busy || !shareable }}
              disabled={busy || !shareable}
              onPress={() => onToggle(true)}
              style={({ pressed }) => [
                styles.primary,
                (busy || !shareable) && styles.primaryDisabled,
                pressed && styles.pressed,
              ]}>
              <UserPlus size={16} color={shareable ? colors.onAccent : colors.textMuted} />
              <Text style={[styles.primaryLabel, !shareable && styles.primaryLabelDisabled]}>
                Partager mon trajet
              </Text>
            </Pressable>
          ) : null}
        </>
      ) : null}

      {state.enabled && companions.length === 0 ? (
        <View style={styles.waiting}>
          {searching ? <ActivityIndicator color={colors.accent} size="small" /> : null}
          <Text style={styles.body}>
            {searching
              ? `Recherche de passagers allant dans ta direction${minutesLeft ? ` — encore ${minutesLeft} min` : '…'}. Tu paies le plein tarif tant que personne ne monte.`
              : 'Personne ne circule sur cet axe pour l’instant. La recherche reprend dès qu’une place se libère.'}
          </Text>
        </View>
      ) : null}

      {companions.length > 0 ? (
        <View style={styles.list}>
          {companions.map((companion) => {
            const split = shareOf(splits, companion.id);
            const onboard = companion.status === 'onboard';
            const dropped = companion.status === 'dropped';

            return (
              <View key={companion.id} style={styles.row}>
                <View style={styles.rowTexts}>
                  <View style={styles.rowTitle}>
                    <Text style={styles.name} numberOfLines={1}>
                      {companion.name}
                    </Text>
                    {companion.demo ? <Text style={styles.badge}>test</Text> : null}
                  </View>
                  <Text style={styles.rowMeta}>
                    {`Monte à ${atKm(companion.boardProgress)} · descend à ${atKm(companion.dropProgress)}`}
                  </Text>
                  <Text
                    style={[
                      styles.rowStatus,
                      onboard && styles.rowStatusOn,
                      dropped && styles.rowStatusDone,
                    ]}>
                    {STATUS_LABEL[companion.status]}
                    {split ? ` · ${formatXaf(split.amount)}` : ''}
                  </Text>
                </View>

                {/* Le chauffeur comme le passager peuvent constater une montée :
                    celui qui la voit en premier la valide, comme la clôture. */}
                {companion.status === 'waiting' ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`${companion.name} est monté`}
                    disabled={busy}
                    onPress={() => onBoard(companion.id)}
                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                    <Text style={styles.actionLabel}>Monté</Text>
                  </Pressable>
                ) : null}

                {onboard ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Déposer ${companion.name}`}
                    disabled={busy}
                    onPress={() => onDrop(companion.id)}
                    style={({ pressed }) => [styles.action, pressed && styles.pressed]}>
                    <Text style={styles.actionLabel}>Déposer</Text>
                  </Pressable>
                ) : null}

                {dropped ? <Check size={16} color={colors.accent} /> : null}
              </View>
            );
          })}
        </View>
      ) : null}

      {/* La part du passager principal, mise en avant : c'est elle qu'il règle. */}
      {state.enabled && !asDriver && mine ? (
        <View style={styles.mine}>
          <View style={styles.mineTexts}>
            <Text style={styles.mineLabel}>Ta part</Text>
            <Text style={styles.mineMeta}>
              {mine.saved > 0
                ? `Seul : ${formatXaf(mine.soloAmount)}`
                : 'Plein tarif tant que tu roules seul'}
            </Text>
          </View>
          <View style={styles.mineAmounts}>
            <Text style={styles.mineValue}>{formatXaf(mine.amount)}</Text>
            {saving ? <Text style={styles.saving}>{saving}</Text> : null}
          </View>
        </View>
      ) : null}

      {state.enabled && !asDriver && companions.every((c) => c.status !== 'onboard') ? (
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => onToggle(false)}
          style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
          <Text style={styles.ghostLabel}>Ne plus partager</Text>
        </Pressable>
      ) : null}

      {state.enabled && asDriver ? (
        <View style={styles.hint}>
          <Clock size={14} color={colors.textMuted} />
          <Text style={styles.hintText}>
            Dès qu’un passager descend, sa place est reproposée à quelqu’un qui suit le même
            itinéraire.
          </Text>
        </View>
      ) : null}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
      paddingTop: 12,
      gap: 10,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    headerIcon: {
      width: 28,
      height: 28,
      borderRadius: 14,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    title: {
      flex: 1,
      color: c.text,
      fontSize: 14,
      fontWeight: '800',
    },
    seats: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '700',
    },
    body: {
      flex: 1,
      color: c.textSecondary,
      fontSize: 12,
      lineHeight: 17,
    },
    waiting: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: c.accent,
      borderRadius: 14,
      paddingVertical: 12,
    },
    primaryDisabled: {
      backgroundColor: c.surfaceStrong,
    },
    primaryLabel: {
      color: c.onAccent,
      fontSize: 14,
      fontWeight: '800',
    },
    primaryLabelDisabled: {
      color: c.textMuted,
    },
    list: {
      gap: 8,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.surfaceMuted,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    rowTexts: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    rowTitle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    name: {
      color: c.text,
      fontSize: 13,
      fontWeight: '700',
      flexShrink: 1,
    },
    badge: {
      color: c.textMuted,
      fontSize: 10,
      fontWeight: '800',
      textTransform: 'uppercase',
      backgroundColor: c.surfaceStrong,
      borderRadius: 6,
      paddingHorizontal: 5,
      paddingVertical: 1,
      overflow: 'hidden',
    },
    rowMeta: {
      color: c.textMuted,
      fontSize: 11,
    },
    rowStatus: {
      color: c.textSecondary,
      fontSize: 11,
      fontWeight: '700',
    },
    rowStatusOn: {
      color: c.accent,
    },
    rowStatusDone: {
      color: c.textMuted,
    },
    action: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.borderStrong,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    actionLabel: {
      color: c.text,
      fontSize: 12,
      fontWeight: '800',
    },
    mine: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.accentSoft,
      borderWidth: 1,
      borderColor: c.accentBorder,
      borderRadius: 14,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    mineTexts: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    mineLabel: {
      color: c.text,
      fontSize: 13,
      fontWeight: '800',
    },
    mineMeta: {
      color: c.textSecondary,
      fontSize: 11,
    },
    mineAmounts: {
      alignItems: 'flex-end',
      gap: 2,
    },
    mineValue: {
      color: c.accent,
      fontSize: 16,
      fontWeight: '800',
    },
    saving: {
      color: c.accent,
      fontSize: 11,
      fontWeight: '800',
    },
    ghost: {
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    ghostLabel: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '700',
      textDecorationLine: 'underline',
    },
    hint: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 6,
    },
    hintText: {
      flex: 1,
      color: c.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    pressed: {
      opacity: 0.75,
    },
  });
