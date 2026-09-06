import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import { MessageSquare } from 'lucide-react-native';
import { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { api } from '../../convex/_generated/api';

/** Au-delà, la pastille n'a plus la place d'être lisible. */
const BADGE_CAP = 49;

export function formatUnread(count: number): string {
  return count > BADGE_CAP ? `${BADGE_CAP}+` : String(count);
}

/**
 * Accès permanent à la messagerie, avec le nombre de messages non lus.
 * Même composant pour les deux rôles : `unreadTotal` additionne les fils où
 * l'utilisateur est passager et ceux où il est chauffeur.
 */
export function InboxButton() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const unread = useQuery(api.chat.unreadTotal, {}) ?? 0;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        unread > 0 ? `Discussions, ${unread} messages non lus` : 'Discussions'
      }
      hitSlop={8}
      onPress={() => router.push('/messages')}
      style={({ pressed }) => [styles.button, pressed && styles.pressed]}>
      <MessageSquare size={17} color={colors.text} />
      {unread > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeLabel}>{formatUnread(unread)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    button: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badge: {
      position: 'absolute',
      top: -4,
      right: -4,
      minWidth: 18,
      height: 18,
      borderRadius: 9,
      paddingHorizontal: 4,
      backgroundColor: c.accent,
      borderWidth: 1.5,
      borderColor: c.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeLabel: {
      color: c.onAccent,
      fontSize: 10,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.75,
    },
  });
