import { useClerk } from '@clerk/expo';
import { useMutation, useQuery } from 'convex/react';
import { router } from 'expo-router';
import {
  CarFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  MessageSquare,
  Moon,
  Sun,
  type LucideIcon,
} from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, useMyAvatarUri } from '@/components/avatar';
import { formatUnread } from '@/components/inbox-button';
import { StarRating } from '@/components/star-rating';
import type { ColorScheme, VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useForgetDevice } from '@/hooks/use-push-token';
import { formatDate } from '@/lib/datetime';
import { formatPhone } from '@/lib/phone';
import { resolveVehicleType } from '@/lib/vehicles';
import { api } from '../../convex/_generated/api';

const ROLE_LABEL = {
  rider: 'Passager',
  driver: 'Chauffeur',
} as const;

const SCHEMES: { value: ColorScheme; label: string; Icon: LucideIcon }[] = [
  { value: 'light', label: 'Clair', Icon: Sun },
  { value: 'dark', label: 'Sombre', Icon: Moon },
];

/** Les 10 points de fonctionnement que l'on nous demande le plus souvent. */
const FAQ: { question: string; answer: string }[] = [
  {
    question: 'Comment le prix affiché est-il calculé ?',
    answer:
      "Sur la grille de Yaoundé : un prix minimum, un tarif au kilomètre et un tarif à la minute, propres à chaque classe de véhicule (Moto, Éco, Confort, Confort+). Le total est arrondi aux 25 FCFA supérieurs. C'est une estimation avant course : l'attente et les détours réels ne sont pas encore comptés. En fin de course, le passager règle ce montant au chauffeur par Orange Money ou MTN Mobile Money, sur le numéro renseigné à l'inscription.",
  },
  {
    question: 'Comment mon itinéraire est-il tracé ?',
    answer:
      "Par OpenRouteService, en profil voiture. Le tracé suit le réseau routier réel : il contourne les bâtiments, respecte les sens de circulation et emprunte les rues existantes. La distance et la durée affichées viennent directement de cette réponse, pas d'un calcul à vue d'œil.",
  },
  {
    question: 'Pourquoi vois-je parfois « tracé approximatif » ?',
    answer:
      "Parce que le service de routage n'a pas répondu (réseau coupé, quota atteint, point de départ trop loin d'une route). Vora bascule alors sur une estimation à vol d'oiseau majorée de 40 % à 26 km/h, et affiche la raison exacte sous le prix. Le trait devient une ligne droite : c'est le signe visuel de ce repli.",
  },
  {
    question: 'Que sont les profils marqués « TEST » ?',
    answer:
      "Cinq chauffeurs fictifs, éparpillés entre 250 et 900 mètres autour de toi à l'ouverture de l'application. Ils servent à essayer la sélection, le zoom sur la carte et la discussion tant qu'aucun vrai chauffeur n'est inscrit. Aucun compte réel ne se trouve derrière : ils ne répondront jamais à tes messages.",
  },
  {
    question: 'Comment se déroule une course ?',
    answer:
      "Touche un chauffeur dans la liste puis le bouton vert : un fil de discussion s'ouvre. Partage-y ta position avec l'icône de repère — cela crée une demande de course que le chauffeur accepte ou refuse directement depuis le message. S'il accepte, tu le vois avancer vers toi sur la carte et tu choisis la distance à suivre : jusqu'à toi, ou jusqu'à ta destination. Chacun peut terminer ou annuler la course à tout moment, et tu notes ensuite ton chauffeur de 0 à 5 étoiles, par demi-étoile. Tout l'historique reste dans « Mes courses ».",
  },
  {
    question: 'Pourquoi Vora a-t-il besoin de ma position ?',
    answer:
      "Elle sert de point de départ à l'itinéraire, centre la carte à l'ouverture et calcule la distance qui te sépare des chauffeurs. Sans autorisation de localisation, aucun itinéraire ni aucun prix ne peut être établi. La position reste sur ton appareil et n'est envoyée qu'au service de routage.",
  },
  {
    question: "Mon itinéraire se recalcule-t-il pendant le trajet ?",
    answer:
      "Non, volontairement. Le point de prise en charge est figé à l'instant où tu choisis ta destination : sans cela, chaque dizaine de mètres parcourus déclencherait un nouveau calcul et saturerait le service de routage. Pour repartir de ta position actuelle, touche le bouton de recentrage sur la carte.",
  },
  {
    question: 'Quelle différence entre un compte passager et un compte chauffeur ?',
    answer:
      "Le rôle est choisi à l'inscription. Un passager cherche une destination, voit les chauffeurs suggérés et leur écrit. Un chauffeur enregistre son véhicule et sa plaque, apparaît sur la carte des passagers à sa dernière position connue, et peut se déclarer disponible ou non depuis cette page. Les suggestions classent les disponibles d'abord, puis les plus proches, puis les mieux notés. Le rôle n'est pas modifiable depuis l'application.",
  },
  {
    question: 'Où sont stockées mes données ?',
    answer:
      "Ton identifiant de connexion et ton e-mail sont gérés par Clerk. Ton profil, tes discussions et tes courses vivent dans la base Convex de Vora. Un message n'est lisible que par toi et le chauffeur concerné. Supprimer ton compte Clerk supprime aussi ton profil Vora et le véhicule associé.",
  },
  {
    question: "Comment changer l'apparence de l'application ?",
    answer:
      "Juste au-dessus de cette section, avec les boutons Clair et Sombre. Le choix est mémorisé sur cet appareil et s'applique à tout l'écran, y compris au fond de carte. Par défaut, Vora s'ouvre en thème clair.",
  },
];

function Row({
  label,
  value,
  styles,
}: {
  label: string;
  value: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/** Question/réponse repliable — même geste que la liste des chauffeurs. */
function FaqItem({
  question,
  answer,
  styles,
  chevronColor,
}: {
  question: string;
  answer: string;
  styles: ReturnType<typeof createStyles>;
  chevronColor: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.faqItem}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((value) => !value)}
        style={({ pressed }) => [styles.faqHeader, pressed && styles.pressed]}>
        <Text style={styles.faqQuestion}>{question}</Text>
        {open ? (
          <ChevronDown size={18} color={chevronColor} />
        ) : (
          <ChevronRight size={18} color={chevronColor} />
        )}
      </Pressable>
      {open ? <Text style={styles.faqAnswer}>{answer}</Text> : null}
    </View>
  );
}

/** Détails du compte Vora : identité, apparence, FAQ, déconnexion. */
export default function ProfileScreen() {
  const { colors, scheme, setScheme } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { signOut } = useClerk();
  const me = useQuery(api.users.getMe);
  const vehicle = useQuery(api.users.getMyVehicle);
  const unread = useQuery(api.chat.unreadTotal, {}) ?? 0;
  const setAvailability = useMutation(api.users.setAvailability);
  const avatarUri = useMyAvatarUri();
  const forgetDevice = useForgetDevice();
  const [availabilityError, setAvailabilityError] = useState<string | null>(null);

  const role = me?.role ? ROLE_LABEL[me.role] : null;
  const vehicleType = vehicle ? resolveVehicleType(vehicle.type) : null;

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
        <Text style={styles.headerTitle}>Mon compte</Text>
      </View>

      {me === undefined ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : me === null ? (
        <Text style={styles.empty}>Profil introuvable.</Text>
      ) : (
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingBottom: Math.max(insets.bottom, 16) + 16 },
          ]}>
          <View style={styles.identity}>
            <Avatar uri={avatarUri} name={me.name} size={84} ring />
            <Text style={styles.name} numberOfLines={1}>
              {me.name}
            </Text>
            {role ? (
              <View style={styles.roleChip}>
                <Text style={styles.roleLabel}>{role}</Text>
              </View>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Coordonnées</Text>
            <Row label="E-mail" value={me.email ?? 'Non renseigné'} styles={styles} />
            <Row
              label="Téléphone"
              value={me.phone ? formatPhone(me.phone) : 'Non renseigné'}
              styles={styles}
            />
            <Row label="Membre depuis" value={formatDate(me._creationTime)} styles={styles} />
          </View>

          {/* Seul un chauffeur est noté : un passager n'a pas de réputation à afficher. */}
          {me.role === 'driver' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Ma note</Text>
              <View style={styles.ratingBlock}>
                <StarRating value={me.rating ?? 0} size={26} />
                <Text style={styles.ratingValue}>
                  {me.rating == null
                    ? 'Pas encore noté'
                    : `${me.rating.toFixed(1).replace('.', ',')} / 5`}
                </Text>
                <Text style={styles.ratingCount}>
                  {me.ratingCount
                    ? `Moyenne sur ${me.ratingCount} course${me.ratingCount > 1 ? 's' : ''} notée${me.ratingCount > 1 ? 's' : ''}`
                    : 'Tes passagers pourront te noter à la fin de chaque course.'}
                </Text>
              </View>
            </View>
          ) : null}

          {me.role === 'driver' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Disponibilité</Text>
              <View style={styles.availabilityRow}>
                <View style={styles.availabilityTexts}>
                  <Text style={styles.availabilityTitle}>
                    {me.isAvailable ? 'Disponible pour une course' : 'Indisponible'}
                  </Text>
                  <Text style={styles.availabilityHint}>
                    {me.isAvailable
                      ? 'Tu apparais sur la carte des passagers et en tête de leurs suggestions.'
                      : 'Tu restes visible sur la carte, mais classé après les chauffeurs disponibles.'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Disponibilité"
                  value={me.isAvailable === true}
                  onValueChange={(next) => {
                    setAvailabilityError(null);
                    void setAvailability({ isAvailable: next }).catch((error: Error) => {
                      console.error('[profil] changement de disponibilité impossible', error);
                      setAvailabilityError(error.message);
                    });
                  }}
                  trackColor={{ false: colors.surfaceStrong, true: colors.accentBorder }}
                  thumbColor={me.isAvailable ? colors.accent : colors.textMuted}
                />
              </View>
              {availabilityError ? (
                <Text style={styles.availabilityError}>{availabilityError}</Text>
              ) : null}
            </View>
          ) : null}

          {me.role === 'driver' ? (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Véhicule</Text>
              {vehicle === undefined ? (
                <ActivityIndicator color={colors.accent} style={styles.inlineLoader} />
              ) : vehicle === null ? (
                <Text style={styles.meta}>Aucun véhicule enregistré.</Text>
              ) : (
                <>
                  <Row label="Type" value={vehicleType?.label ?? vehicle.type} styles={styles} />
                  <Row label="Plaque" value={vehicle.plate} styles={styles} />
                  {vehicleType ? (
                    <Row label="Classe tarifaire" value={vehicleType.tariffClass} styles={styles} />
                  ) : null}
                </>
              )}
            </View>
          ) : null}

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              unread > 0 ? `Discussions, ${unread} messages non lus` : 'Discussions'
            }
            onPress={() => router.push('/messages')}
            style={({ pressed }) => [styles.card, styles.link, pressed && styles.pressed]}>
            <View style={styles.linkIcon}>
              <MessageSquare size={18} color={colors.accent} />
            </View>
            <View style={styles.linkTexts}>
              <Text style={styles.linkTitle}>Mes discussions</Text>
              <Text style={styles.linkSub}>
                {unread > 0
                  ? `${unread} message${unread > 1 ? 's' : ''} non lu${unread > 1 ? 's' : ''}`
                  : 'Tous les fils avec tes chauffeurs et passagers'}
              </Text>
            </View>
            {unread > 0 ? (
              <View style={styles.linkBadge}>
                <Text style={styles.linkBadgeLabel}>{formatUnread(unread)}</Text>
              </View>
            ) : null}
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Mes courses"
            onPress={() => router.push('/rides')}
            style={({ pressed }) => [styles.card, styles.link, pressed && styles.pressed]}>
            <View style={styles.linkIcon}>
              <CarFront size={18} color={colors.accent} />
            </View>
            <View style={styles.linkTexts}>
              <Text style={styles.linkTitle}>Mes courses</Text>
              <Text style={styles.linkSub}>
                Historique complet, en cours comme terminées ou annulées
              </Text>
            </View>
            <ChevronRight size={18} color={colors.textMuted} />
          </Pressable>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Apparence</Text>
            <View style={styles.schemeRow}>
              {SCHEMES.map((option) => {
                const active = scheme === option.value;
                return (
                  <Pressable
                    key={option.value}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => setScheme(option.value)}
                    style={({ pressed }) => [
                      styles.schemeOption,
                      active && styles.schemeOptionActive,
                      pressed && styles.pressed,
                    ]}>
                    <option.Icon
                      size={17}
                      color={active ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.schemeLabel, active && styles.schemeLabelActive]}>
                      {option.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.meta}>Le choix est mémorisé sur cet appareil.</Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Questions fréquentes</Text>
            {FAQ.map((item) => (
              <FaqItem
                key={item.question}
                question={item.question}
                answer={item.answer}
                styles={styles}
                chevronColor={colors.textSecondary}
              />
            ))}
          </View>

          <Pressable
            accessibilityRole="button"
            onPress={() =>
              // L'appareil doit cesser de recevoir les notifications de ce compte.
              void forgetDevice().finally(() => void signOut())
            }
            style={({ pressed }) => [styles.signOut, pressed && styles.pressed]}>
            <Text style={styles.signOutLabel}>Se déconnecter</Text>
          </Pressable>
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
    inlineLoader: {
      alignSelf: 'flex-start',
      marginTop: 6,
    },
    empty: {
      color: c.textMuted,
      fontSize: 14,
      textAlign: 'center',
      marginTop: 40,
    },
    content: {
      paddingHorizontal: 16,
      paddingTop: 24,
      gap: 16,
    },
    identity: {
      alignItems: 'center',
      gap: 10,
    },
    name: {
      color: c.text,
      fontSize: 22,
      fontWeight: '800',
    },
    roleChip: {
      backgroundColor: c.accentSoft,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: c.accentBorder,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    roleLabel: {
      color: c.accent,
      fontSize: 12,
      fontWeight: '800',
    },
    card: {
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 4,
    },
    cardTitle: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
      marginBottom: 6,
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 16,
      paddingVertical: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    rowLabel: {
      color: c.textSecondary,
      fontSize: 14,
    },
    rowValue: {
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
      flexShrink: 1,
      textAlign: 'right',
    },
    meta: {
      color: c.textMuted,
      fontSize: 12,
      paddingVertical: 6,
    },
    availabilityRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 4,
    },
    availabilityTexts: {
      flex: 1,
      minWidth: 0,
      gap: 3,
    },
    availabilityTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
    },
    availabilityHint: {
      color: c.textMuted,
      fontSize: 12,
      lineHeight: 16,
    },
    availabilityError: {
      color: c.danger,
      fontSize: 12,
      paddingTop: 4,
    },
    ratingBlock: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 6,
    },
    ratingValue: {
      color: c.text,
      fontSize: 18,
      fontWeight: '800',
    },
    ratingCount: {
      color: c.textMuted,
      fontSize: 12,
      lineHeight: 16,
      textAlign: 'center',
    },
    schemeRow: {
      flexDirection: 'row',
      gap: 8,
    },
    schemeOption: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      height: 46,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
    },
    schemeOptionActive: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    schemeLabel: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '700',
    },
    schemeLabelActive: {
      color: c.accent,
    },
    faqItem: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
    },
    faqHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 12,
    },
    faqQuestion: {
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
      flex: 1,
    },
    faqAnswer: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 19,
      paddingBottom: 14,
      paddingRight: 8,
    },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    linkIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkTexts: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    linkTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
    },
    linkSub: {
      color: c.textMuted,
      fontSize: 12,
    },
    linkBadge: {
      minWidth: 22,
      height: 22,
      borderRadius: 11,
      paddingHorizontal: 6,
      backgroundColor: c.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    linkBadgeLabel: {
      color: c.onAccent,
      fontSize: 11,
      fontWeight: '800',
    },
    signOut: {
      alignItems: 'center',
      backgroundColor: c.dangerBg,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.dangerBorder,
      paddingVertical: 14,
    },
    signOutLabel: {
      color: c.danger,
      fontSize: 15,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.75,
    },
  });
