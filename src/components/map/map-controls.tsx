import { Box, LocateFixed, Navigation, Pause, Play } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { MapSimState, MapViewMode } from '@/components/map/native-map-shared';
import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatDuration } from '@/lib/geo-utils';

type Props = {
  mode: MapViewMode;
  /** `true` quand la caméra suit encore l'utilisateur. */
  following: boolean;
  onToggleView: () => void;
  /** `false` tant qu'aucun itinéraire n'est tracé : rien à parcourir. */
  canSimulate: boolean;
  simState: MapSimState;
  /** Temps restant de la simulation, en secondes. */
  simRemainingS: number;
  onToggleSim: () => void;
};

/**
 * Commandes posées sur la carte, visibles par le passager comme par le
 * chauffeur.
 *
 * Placées à mi-hauteur sur le bord droit : la barre de recherche occupe le haut
 * de l'écran de carte, et les fiches de course occupent le bas.
 */
export function MapControls({
  mode,
  following,
  onToggleView,
  canSimulate,
  simState,
  simRemainingS,
  onToggleSim,
}: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const flat = mode === '2d';
  /** En 3D, la carte a été déplacée à la main : le suivi est décroché. */
  const adrift = !flat && !following;

  const viewLabel = flat ? 'Vue 3D' : adrift ? 'Recentrer' : 'Vue 2D';
  const ViewIcon = flat ? Box : adrift ? LocateFixed : Navigation;

  const running = simState === 'running';
  const paused = simState === 'paused';
  // En pause, le temps restant est celui d'un trajet déjà entamé : le rappeler
  // dit mieux que « Reprendre » que rien n'a été perdu.
  const simLabel = running
    ? formatDuration(simRemainingS)
    : paused
      ? `Reprendre · ${formatDuration(simRemainingS)}`
      : 'Simuler';

  return (
    <View pointerEvents="box-none" style={styles.holder}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          flat
            ? 'Passer en vue 3D'
            : adrift
              ? 'Recentrer la carte sur ma position'
              : 'Revenir à la vue à plat'
        }
        accessibilityState={{ selected: !flat }}
        onPress={onToggleView}
        hitSlop={8}
        style={({ pressed }) => [
          styles.button,
          !flat && styles.buttonActive,
          pressed && styles.pressed,
        ]}>
        <ViewIcon size={18} color={flat ? colors.text : colors.accent} />
        <Text style={[styles.label, !flat && styles.labelActive]}>{viewLabel}</Text>
      </Pressable>

      {canSimulate ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            running
              ? 'Mettre la simulation en pause'
              : paused
                ? 'Reprendre la simulation là où elle s’est arrêtée'
                : 'Simuler le trajet sur l’itinéraire'
          }
          accessibilityState={{ selected: running || paused }}
          onPress={onToggleSim}
          hitSlop={8}
          style={({ pressed }) => [
            styles.button,
            (running || paused) && styles.buttonActive,
            pressed && styles.pressed,
          ]}>
          {running ? (
            <Pause size={16} color={colors.accent} fill={colors.accent} />
          ) : (
            <Play
              size={16}
              color={paused ? colors.accent : colors.text}
              fill={paused ? colors.accent : colors.text}
            />
          )}
          <Text style={[styles.label, (running || paused) && styles.labelActive]}>{simLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    holder: {
      position: 'absolute',
      right: 12,
      top: '38%',
      gap: 8,
    },
    button: {
      minWidth: 62,
      alignItems: 'center',
      gap: 2,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.border,
      borderRadius: 14,
      paddingHorizontal: 10,
      paddingVertical: 8,
      shadowColor: '#000',
      shadowOpacity: 0.15,
      shadowRadius: 6,
      shadowOffset: { width: 0, height: 2 },
      elevation: 3,
    },
    buttonActive: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    label: {
      color: c.text,
      fontSize: 10,
      fontWeight: '800',
    },
    labelActive: {
      color: c.accent,
    },
    pressed: {
      opacity: 0.75,
    },
  });
