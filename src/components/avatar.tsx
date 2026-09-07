import { useUser } from '@clerk/expo';
import { Image } from 'expo-image';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';

/**
 * Photo de profil de l'utilisateur connecté.
 *
 * Elle vient de Clerk et non de Convex : c'est Clerk qui héberge l'image (celle
 * envoyée par l'utilisateur ou celle de son compte Google), et il en fournit
 * toujours une — à défaut de photo, une image générée à partir des initiales.
 */
export function useMyAvatarUri(): string | null {
  const { user } = useUser();
  return user?.imageUrl ?? null;
}

type Props = {
  uri?: string | null;
  /** Sert à l'initiale de repli si l'image manque ou ne charge pas. */
  name?: string | null;
  size?: number;
  /** Cercle vert autour de l'avatar, pour la page compte. */
  ring?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function Avatar({ uri, name, size = 34, ring = false, style }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [failed, setFailed] = useState(false);

  const initial = (name ?? '').trim().charAt(0).toUpperCase() || '?';
  const showImage = !!uri && !failed;

  return (
    <View
      style={[
        styles.root,
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: ring ? 2 : 1,
          borderColor: ring ? colors.accent : colors.borderStrong,
        },
        style,
      ]}>
      {showImage ? (
        <Image
          source={{ uri }}
          style={{ width: size, height: size }}
          contentFit="cover"
          transition={150}
          onError={() => setFailed(true)}
          accessibilityIgnoresInvertColors
        />
      ) : (
        <Text style={[styles.initial, { fontSize: size * 0.42 }]}>{initial}</Text>
      )}
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      alignItems: 'center',
      justifyContent: 'center',
      overflow: 'hidden',
      backgroundColor: c.surfaceStrong,
    },
    initial: {
      color: c.accent,
      fontWeight: '800',
    },
  });
