import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import { ChevronLeft, MessagesSquare } from 'lucide-react-native';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatStamp } from '@/lib/datetime';
import { api } from '../../convex/_generated/api';

/**
 * Boîte de réception, identique pour les deux rôles : un passager y retrouve
 * ses chauffeurs, un chauffeur y retrouve ses passagers.
 */
export default function MessagesScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const conversations = useQuery(api.chat.listConversations, {});

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
        <Text style={styles.headerTitle}>Discussions</Text>
      </View>

      {conversations === undefined ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : conversations.length === 0 ? (
        <View style={styles.emptyWrap}>
          <MessagesSquare size={40} color={colors.textMuted} />
          <Text style={styles.empty}>Aucune discussion pour le moment.</Text>
          <Text style={styles.emptyHint}>
            Sélectionne un chauffeur sur la carte pour démarrer une conversation.
          </Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.list,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}>
          {conversations.map((conversation) => (
            <Pressable
              key={conversation.id}
              accessibilityRole="button"
              accessibilityLabel={`Discussion avec ${conversation.title}`}
              onPress={() =>
                router.push({
                  pathname: '/chat/[driverKey]',
                  params: {
                    driverKey: conversation.driverKey,
                    conversationId: conversation.id,
                    name: conversation.title,
                  },
                })
              }
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
              <View style={styles.avatar}>
                <Text style={styles.avatarLabel}>
                  {conversation.title.charAt(0).toUpperCase()}
                </Text>
              </View>

              <View style={styles.texts}>
                <Text style={styles.name} numberOfLines={1}>
                  {conversation.title}
                </Text>
                <Text
                  style={[styles.preview, conversation.unread > 0 && styles.previewUnread]}
                  numberOfLines={1}>
                  {conversation.preview ?? 'Aucun message'}
                </Text>
              </View>

              <View style={styles.right}>
                <Text style={styles.stamp}>{formatStamp(conversation.lastMessageAt)}</Text>
                {conversation.unread > 0 ? (
                  <View style={styles.badge}>
                    <Text style={styles.badgeLabel}>
                      {conversation.unread >= 50 ? '49+' : conversation.unread}
                    </Text>
                  </View>
                ) : null}
              </View>
            </Pressable>
          ))}
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
    avatar: {
      width: 46,
      height: 46,
      borderRadius: 23,
      backgroundColor: c.surfaceStrong,
      borderWidth: 1,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarLabel: {
      color: c.accent,
      fontSize: 18,
      fontWeight: '800',
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
    preview: {
      color: c.textMuted,
      fontSize: 13,
    },
    previewUnread: {
      color: c.text,
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
    badge: {
      minWidth: 20,
      height: 20,
      borderRadius: 10,
      paddingHorizontal: 6,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    badgeLabel: {
      color: c.onAccent,
      fontSize: 11,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.75,
    },
  });
