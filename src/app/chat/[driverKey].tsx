import { useMutation, useQuery } from 'convex/react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  Check,
  ChevronLeft,
  MapPin,
  Navigation,
  Phone,
  Route,
  Send,
  Video,
  X,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useGeo } from '@/hooks/use-geo';
import { formatDayLabel, formatTime, isSameDay } from '@/lib/datetime';
import { reverseGeocode } from '@/lib/geocoding';
import {
  rideStatusColor,
  rideStatusLabel,
  rideStatusTint,
  type RideStatus,
} from '@/lib/rides';
import { isDemoDriverKey } from '@/lib/drivers';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

/**
 * Widget « position partagée ».
 *
 * Il ouvre le tracé vers le point indiqué, et porte le cycle de vie de la course
 * née de ce partage : le chauffeur y accepte ou refuse, les deux y suivent le
 * statut ensuite.
 */
function LocationCard({
  mine,
  placeName,
  colors,
  styles,
  rideStatus,
  canRespond,
  responding,
  onPress,
  onRespond,
  onTrack,
}: {
  mine: boolean;
  placeName?: string;
  colors: VoraPalette;
  styles: ReturnType<typeof createStyles>;
  rideStatus?: RideStatus;
  /** Le chauffeur peut trancher : la course existe et attend encore. */
  canRespond: boolean;
  responding: boolean;
  onPress: () => void;
  onRespond: (accept: boolean) => void;
  onTrack: () => void;
}) {
  const tint = mine ? colors.bubbleMineText : colors.accent;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Voir l'itineraire vers ${placeName ?? 'la position partagee'}`}
      onPress={onPress}
      style={({ pressed }) => [
        styles.location,
        mine ? styles.locationMine : styles.locationTheirs,
        pressed && styles.pressed,
      ]}>
      <View style={[styles.locationIcon, mine ? styles.locationIconMine : styles.locationIconTheirs]}>
        <MapPin size={18} color={tint} />
      </View>

      <View style={styles.locationTexts}>
        <Text style={[styles.body, mine && styles.bodyMine]}>Position partagee</Text>
        <Text style={[styles.locationPlace, mine && styles.locationPlaceMine]} numberOfLines={2}>
          {placeName ?? 'Lieu inconnu'}
        </Text>
        <View style={styles.locationCta}>
          <Navigation size={12} color={tint} />
          <Text style={[styles.locationLink, mine && styles.locationLinkMine]}>
            Voir l&apos;itineraire
          </Text>
        </View>

        {rideStatus ? (
          <View
            style={[styles.ridePill, { backgroundColor: rideStatusTint(rideStatus, colors) }]}>
            <Text style={[styles.ridePillLabel, { color: rideStatusColor(rideStatus, colors) }]}>
              {rideStatusLabel(rideStatus, !mine)}
            </Text>
          </View>
        ) : null}

        {/* Voir le trajet avant de s'engager : distance jusqu'au client, et
            jusqu'où il veut aller. */}
        {canRespond ? (
          <Pressable
            accessibilityRole="button"
            onPress={onTrack}
            style={({ pressed }) => [styles.preview, pressed && styles.pressed]}>
            <Route size={13} color={colors.text} />
            <Text style={styles.previewLabel}>Voir le trajet</Text>
          </Pressable>
        ) : null}

        {canRespond ? (
          <View style={styles.rideActions}>
            <Pressable
              accessibilityRole="button"
              disabled={responding}
              onPress={() => onRespond(true)}
              style={({ pressed }) => [styles.accept, pressed && styles.pressed]}>
              <Check size={14} color={colors.onAccent} />
              <Text style={styles.acceptLabel}>Accepter</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              disabled={responding}
              onPress={() => onRespond(false)}
              style={({ pressed }) => [styles.decline, pressed && styles.pressed]}>
              <X size={14} color={colors.danger} />
              <Text style={styles.declineLabel}>Refuser</Text>
            </Pressable>
          </View>
        ) : null}

        {rideStatus && rideStatus !== 'requested' ? (
          <Pressable
            accessibilityRole="button"
            onPress={onTrack}
            style={({ pressed }) => [styles.track, pressed && styles.pressed]}>
            <Text style={[styles.trackLabel, mine && styles.locationLinkMine]}>
              Suivre la course
            </Text>
          </Pressable>
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * Discussion passager ↔ chauffeur, façon messagerie mobile mais aux couleurs
 * Vora : bulles vertes pour le passager, neutres en face, dans le thème courant.
 */
export default function ChatScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const {
    driverKey,
    name,
    vehicle,
    conversationId: fromInbox,
    destLat,
    destLng,
    destName,
  } = useLocalSearchParams<{
    driverKey: string;
    name?: string;
    vehicle?: string;
    /** Présent quand on arrive depuis la boîte de réception : le fil existe déjà. */
    conversationId?: string;
    /** Destination en cours sur la carte, si le fil a été ouvert depuis celle-ci. */
    destLat?: string;
    destLng?: string;
    destName?: string;
  }>();

  const driverName = name?.trim() || 'Chauffeur';
  const openConversation = useMutation(api.chat.openConversation);
  const sendMessage = useMutation(api.chat.sendMessage);
  const markRead = useMutation(api.chat.markRead);
  const shareLocation = useMutation(api.chat.shareLocation);
  const respondToRide = useMutation(api.rides.respond);
  const [responding, setResponding] = useState(false);
  const geo = useGeo();

  const [conversationId, setConversationId] = useState<Id<'conversations'> | null>(
    (fromInbox as Id<'conversations'> | undefined) ?? null,
  );
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sharing, setSharing] = useState(false);
  const listRef = useRef<ScrollView>(null);

  const messages = useQuery(
    api.chat.listMessages,
    conversationId ? { conversationId } : 'skip',
  );
  const details = useQuery(
    api.chat.getConversation,
    conversationId ? { conversationId } : 'skip',
  );

  /** Nom de l'interlocuteur : le serveur sait de quel côté du fil on est. */
  const title = details?.title ?? driverName;

  useEffect(() => {
    // Fil déjà connu (boîte de réception) : rien à ouvrir.
    if (fromInbox) return;

    let active = true;
    void (async () => {
      try {
        const id = await openConversation({ driverKey: driverKey ?? '', driverName });
        if (active) setConversationId(id);
      } catch (err) {
        console.error('[chat] ouverture du fil impossible', err);
        if (active) setError((err as Error).message);
      }
    })();
    return () => {
      active = false;
    };
  }, [driverKey, driverName, fromInbox, openConversation]);

  /**
   * Marque le fil lu à chaque nouveau message affiché. La borne évite la boucle :
   * `markRead` modifie la conversation, ce qui réinvalide `listMessages`.
   */
  const markedUpToRef = useRef(0);
  useEffect(() => {
    if (!conversationId || !messages?.length) return;
    const newest = messages[messages.length - 1].sentAt;
    if (newest <= markedUpToRef.current) return;
    markedUpToRef.current = newest;
    void markRead({ conversationId });
  }, [conversationId, markRead, messages]);

  /**
   * Partage la position courante. Le nom du lieu est cherché avant l'envoi mais
   * n'est pas bloquant : sans geocodage, les coordonnees suffisent au trace.
   */
  const share = useCallback(async () => {
    if (!conversationId || sharing) return;

    const position = geo.position;
    if (!position) {
      Alert.alert(
        'Position indisponible',
        'Autorise la localisation pour partager ou tu te trouves.',
      );
      return;
    }

    setSharing(true);
    try {
      const place = await reverseGeocode([position.lng, position.lat]).catch(() => null);
      const toLat = Number(destLat);
      const toLng = Number(destLng);
      const hasDestination = Number.isFinite(toLat) && Number.isFinite(toLng) && !!destLat && !!destLng;

      await shareLocation({
        conversationId,
        lat: position.lat,
        lng: position.lng,
        placeName: place?.place_name ?? place?.text,
        destLat: hasDestination ? toLat : undefined,
        destLng: hasDestination ? toLng : undefined,
        destName: hasDestination ? destName || undefined : undefined,
      });
    } catch (err) {
      console.error('[chat] partage de position impossible', err);
      setError((err as Error).message);
    } finally {
      setSharing(false);
    }
  }, [conversationId, destLat, destLng, destName, geo.position, sharing, shareLocation]);

  /** Réponse du chauffeur à une demande de course, depuis le message lui-même. */
  const respond = useCallback(
    async (rideId: Id<'rides'>, accept: boolean) => {
      if (responding) return;
      setResponding(true);
      try {
        await respondToRide({ rideId, accept });
      } catch (err) {
        console.error('[course] réponse impossible', err);
        Alert.alert('Action impossible', (err as Error).message);
      } finally {
        setResponding(false);
      }
    },
    [responding, respondToRide],
  );

  const openPickup = useCallback(
    (lat: number, lng: number, label?: string) => {
      router.push({
        pathname: '/pickup',
        params: { lat: String(lat), lng: String(lng), label: label ?? '', who: title },
      });
    },
    [title],
  );

  const notYet = useCallback((feature: string) => {
    Alert.alert(feature, `${feature} n'est pas encore disponible dans Vora.`);
  }, []);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || !conversationId || sending) return;
    setSending(true);
    try {
      await sendMessage({ conversationId, body });
      setDraft('');
    } catch (err) {
      console.error('[chat] envoi impossible', err);
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }, [conversationId, draft, sendMessage, sending]);

  const loading = !error && (conversationId === null || messages === undefined);
  const canSend = draft.trim().length > 0 && !!conversationId && !sending;

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

        <View style={styles.avatar}>
          <Text style={styles.avatarLabel}>{title.charAt(0).toUpperCase()}</Text>
        </View>

        <View style={styles.headerTexts}>
          <Text style={styles.headerName} numberOfLines={1}>
            {title}
          </Text>
          {vehicle ? (
            <Text style={styles.headerSub} numberOfLines={1}>
              {vehicle}
            </Text>
          ) : null}
        </View>

        <View style={styles.headerActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Appeler"
            hitSlop={8}
            onPress={() => notYet("L'appel audio")}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
            <Phone size={19} color={colors.accent} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Appel vidéo"
            hitSlop={8}
            onPress={() => notYet("L'appel vidéo")}
            style={({ pressed }) => [styles.headerAction, pressed && styles.pressed]}>
            <Video size={19} color={colors.accent} />
          </Pressable>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={insets.top}>
        <ScrollView
          ref={listRef}
          style={styles.flex}
          contentContainerStyle={styles.thread}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          keyboardShouldPersistTaps="handled">
          {isDemoDriverKey(driverKey) ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>
                Profil de test : tes messages sont bien enregistrés, mais aucun compte réel ne se
                trouve derrière — personne ne répondra.
              </Text>
            </View>
          ) : null}

          {error ? (
            <View style={[styles.notice, styles.noticeError]}>
              <Text style={[styles.noticeText, styles.noticeTextError]}>{error}</Text>
            </View>
          ) : null}

          {loading ? (
            <ActivityIndicator color={colors.accent} style={styles.loader} />
          ) : messages && messages.length === 0 ? (
            <Text style={styles.empty}>{`Écris ton premier message à ${title}.`}</Text>
          ) : null}

          {(messages ?? []).map((message, index) => {
            const previous = index > 0 ? messages![index - 1] : null;
            const newDay = !previous || !isSameDay(previous.sentAt, message.sentAt);

            return (
              <View key={message.id}>
                {newDay ? (
                  <View style={styles.dayWrap}>
                    <Text style={styles.day}>{formatDayLabel(message.sentAt)}</Text>
                  </View>
                ) : null}

                <View style={[styles.bubble, message.mine ? styles.mine : styles.theirs]}>
                  {message.kind === 'location' && message.lat != null && message.lng != null ? (
                    <LocationCard
                      mine={message.mine}
                      placeName={message.placeName}
                      colors={colors}
                      styles={styles}
                      rideStatus={message.rideStatus as RideStatus | undefined}
                      canRespond={
                        !message.mine &&
                        details?.side === 'driver' &&
                        message.rideStatus === 'requested' &&
                        !!message.rideId
                      }
                      responding={responding}
                      onRespond={(accept) => void respond(message.rideId!, accept)}
                      onTrack={() =>
                        router.push({
                          pathname: '/ride/[rideId]',
                          params: { rideId: message.rideId! },
                        })
                      }
                      onPress={() => openPickup(message.lat!, message.lng!, message.placeName)}
                    />
                  ) : (
                    <Text style={[styles.body, message.mine && styles.bodyMine]}>
                      {message.body}
                    </Text>
                  )}
                  <Text style={[styles.time, message.mine && styles.timeMine]}>
                    {formatTime(message.sentAt)}
                  </Text>
                </View>
              </View>
            );
          })}
        </ScrollView>

        <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Partager ma position"
            disabled={sharing}
            onPress={() => void share()}
            style={({ pressed }) => [styles.attach, pressed && styles.pressed]}>
            {sharing ? (
              <ActivityIndicator color={colors.accent} size="small" />
            ) : (
              <MapPin size={19} color={colors.accent} />
            )}
          </Pressable>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder="Message"
            placeholderTextColor={colors.placeholder}
            multiline
            style={styles.input}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Envoyer"
            disabled={!canSend}
            onPress={() => void send()}
            style={({ pressed }) => [
              styles.send,
              !canSend && styles.sendDisabled,
              pressed && styles.pressed,
            ]}>
            <Send size={18} color={canSend ? colors.onAccent : colors.textMuted} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    flex: {
      flex: 1,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
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
    headerTexts: {
      flex: 1,
      minWidth: 0,
    },
    headerName: {
      color: c.text,
      fontSize: 16,
      fontWeight: '800',
    },
    headerSub: {
      color: c.textMuted,
      fontSize: 12,
      marginTop: 2,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    headerAction: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
    },
    thread: {
      paddingHorizontal: 12,
      paddingVertical: 14,
      gap: 6,
    },
    loader: {
      marginTop: 24,
    },
    empty: {
      color: c.textMuted,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 32,
    },
    notice: {
      backgroundColor: c.warningBg,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.warningBorder,
      paddingHorizontal: 12,
      paddingVertical: 8,
      marginBottom: 8,
    },
    noticeError: {
      backgroundColor: c.dangerBg,
      borderColor: c.dangerBorder,
    },
    noticeText: {
      color: c.warning,
      fontSize: 12,
      lineHeight: 17,
    },
    noticeTextError: {
      color: c.danger,
    },
    dayWrap: {
      alignItems: 'center',
      marginVertical: 10,
    },
    day: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '700',
      backgroundColor: c.surfaceMuted,
      borderRadius: 10,
      overflow: 'hidden',
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    bubble: {
      maxWidth: '82%',
      borderRadius: 16,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    mine: {
      alignSelf: 'flex-end',
      backgroundColor: c.accent,
      borderBottomRightRadius: 4,
    },
    theirs: {
      alignSelf: 'flex-start',
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
      borderBottomLeftRadius: 4,
    },
    body: {
      color: c.text,
      fontSize: 15,
      lineHeight: 20,
    },
    bodyMine: {
      color: c.bubbleMineText,
      fontWeight: '600',
    },
    time: {
      color: c.textMuted,
      fontSize: 10,
      marginTop: 3,
      alignSelf: 'flex-end',
    },
    timeMine: {
      color: c.bubbleMineTime,
    },
    location: {
      flexDirection: 'row',
      gap: 10,
      borderRadius: 12,
      borderWidth: 1,
      padding: 8,
      marginBottom: 2,
      minWidth: 210,
    },
    locationMine: {
      borderColor: 'rgba(255,255,255,0.35)',
      backgroundColor: 'rgba(255,255,255,0.14)',
    },
    locationTheirs: {
      borderColor: c.border,
      backgroundColor: c.surfaceAlt,
    },
    locationIcon: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
    },
    locationIconMine: {
      backgroundColor: 'rgba(255,255,255,0.18)',
    },
    locationIconTheirs: {
      backgroundColor: c.accentSoft,
    },
    locationTexts: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    locationPlace: {
      color: c.textSecondary,
      fontSize: 12,
      lineHeight: 16,
    },
    locationPlaceMine: {
      color: c.bubbleMineTime,
    },
    locationCta: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      marginTop: 2,
    },
    locationLink: {
      color: c.accent,
      fontSize: 12,
      fontWeight: '800',
    },
    locationLinkMine: {
      color: c.bubbleMineText,
    },
    ridePill: {
      alignSelf: 'flex-start',
      borderRadius: 999,
      paddingHorizontal: 8,
      paddingVertical: 2,
      marginTop: 4,
    },
    ridePillLabel: {
      fontSize: 10,
      fontWeight: '800',
    },
    rideActions: {
      flexDirection: 'row',
      gap: 6,
      marginTop: 6,
    },
    accept: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      height: 32,
      borderRadius: 10,
      backgroundColor: c.accent,
    },
    acceptLabel: {
      color: c.onAccent,
      fontSize: 12,
      fontWeight: '800',
    },
    decline: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 5,
      height: 32,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.dangerBorder,
      backgroundColor: c.dangerBg,
    },
    declineLabel: {
      color: c.danger,
      fontSize: 12,
      fontWeight: '800',
    },
    preview: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 32,
      borderRadius: 10,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      marginTop: 6,
    },
    previewLabel: {
      color: c.text,
      fontSize: 12,
      fontWeight: '700',
    },
    track: {
      marginTop: 6,
    },
    trackLabel: {
      color: c.accent,
      fontSize: 12,
      fontWeight: '800',
    },
    attach: {
      width: 44,
      height: 44,
      borderRadius: 22,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
    },
    composer: {
      flexDirection: 'row',
      alignItems: 'flex-end',
      gap: 8,
      paddingHorizontal: 12,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: c.divider,
      backgroundColor: c.surfaceAlt,
    },
    input: {
      flex: 1,
      maxHeight: 120,
      minHeight: 44,
      color: c.text,
      fontSize: 15,
      backgroundColor: c.surfaceMuted,
      borderRadius: 22,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingTop: 12,
      paddingBottom: 12,
    },
    send: {
      width: 44,
      height: 44,
      borderRadius: 22,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    sendDisabled: {
      backgroundColor: c.surfaceStrong,
      borderWidth: 1,
      borderColor: c.border,
    },
    pressed: {
      opacity: 0.75,
    },
  });
