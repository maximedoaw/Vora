import { LocateFixed } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

import type { GeoState } from '@/hooks/use-geolocation';

type Props = {
  geo: GeoState;
  onRecenter: () => void;
  raised?: boolean;
};

function bannerContent(geo: GeoState) {
  switch (geo.status) {
    case 'denied':
      return {
        text: 'Localisation refusée. Autorise-la dans les réglages, puis réessaie.',
        action: 'Réessayer',
        tone: 'error' as const,
      };
    case 'unavailable':
      return {
        text: geo.error ?? 'Géolocalisation indisponible sur cet appareil.',
        action: null,
        tone: 'error' as const,
      };
    case 'error':
      return {
        text: geo.error ?? "Impossible d'obtenir ta position.",
        action: 'Réessayer',
        tone: 'error' as const,
      };
    case 'prompting':
    case 'idle':
      return {
        text: 'Autorise la localisation pour te placer sur la carte.',
        action: 'Activer',
        tone: 'info' as const,
      };
    default:
      return null;
  }
}

export function MapOverlay({ geo, onRecenter, raised = false }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const banner = bannerContent(geo);

  return (
    <View pointerEvents="box-none" style={styles.fill}>
      {banner ? (
        <View style={styles.bannerWrap}>
          <View style={[styles.banner, banner.tone === 'error' && styles.bannerError]}>
            <Text style={[styles.bannerText, banner.tone === 'error' && styles.bannerTextError]}>
              {banner.text}
            </Text>
            {banner.action ? (
              <Pressable onPress={geo.requestOnce} style={styles.bannerBtn}>
                <Text style={styles.bannerBtnLabel}>{banner.action}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ) : null}

      {geo.position ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Me recentrer"
          onPress={onRecenter}
          style={[styles.fab, raised && styles.fabRaised]}>
          <LocateFixed size={21} color={colors.text} />
        </Pressable>
      ) : null}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    fill: {
      flex: 1,
    },
    bannerWrap: {
      marginTop: 8,
      zIndex: 1,
    },
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: c.surface,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 12,
      paddingVertical: 10,
    },
    bannerError: {
      borderColor: c.dangerBorder,
      backgroundColor: c.dangerBg,
    },
    bannerText: {
      flex: 1,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    bannerTextError: {
      color: c.danger,
    },
    bannerBtn: {
      backgroundColor: c.accent,
      borderRadius: 10,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    bannerBtnLabel: {
      color: c.background,
      fontSize: 12,
      fontWeight: '800',
    },
    fab: {
      position: 'absolute',
      right: 0,
      bottom: 24,
      width: 48,
      height: 48,
      borderRadius: 24,
      backgroundColor: c.surfaceAlt,
      borderWidth: 1,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    fabRaised: {
      bottom: 168,
    },
  });
