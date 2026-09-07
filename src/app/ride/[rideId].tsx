import { useMutation, useQuery } from 'convex/react';
import { router, useLocalSearchParams } from 'expo-router';
import {
  CarFront,
  ChevronLeft,
  Clock,
  Flag,
  MapPin,
  MessageSquare,
  Route as RouteIcon,
  Wallet,
} from 'lucide-react-native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { NativeMap } from '@/components/map/native-map';
import { RidePayment, type PaymentMethod } from '@/components/ride-payment';
import { StarRating } from '@/components/star-rating';
import { useGeo } from '@/hooks/use-geo';
import type { MapCameraHandle, MapDriver } from '@/components/map/native-map-shared';
import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useRoute } from '@/hooks/use-route';
import { useSettledOrigin } from '@/hooks/use-settled-origin';
import { formatDistance, formatDuration } from '@/lib/geo-utils';
import type { GeocodeFeature } from '@/lib/geocoding';
import { FIRST_FIX_ZOOM } from '@/lib/map';
import { isRideActive, rideStatusColor, rideStatusLabel, rideStatusTint } from '@/lib/rides';
import type { LngLat } from '@/lib/routing';
import { estimateFare, formatXaf, resolveVehicleType } from '@/lib/vehicles';
import { api } from '../../../convex/_generated/api';
import type { Id } from '../../../convex/_generated/dataModel';

/**
 * Suivi d'une course en direct.
 *
 * Le passager y voit son chauffeur avancer vers lui et le statut évoluer ; le
 * chauffeur y démarre et clôt la course. Les deux peuvent annuler tant qu'elle
 * n'est pas close.
 */
export default function RideScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapCameraHandle>(null);
  const geo = useGeo();
  const { rideId } = useLocalSearchParams<{ rideId: string }>();

  const ride = useQuery(api.rides.get, { rideId: rideId as Id<'rides'> });
  const start = useMutation(api.rides.start);
  const complete = useMutation(api.rides.complete);
  const cancel = useMutation(api.rides.cancel);
  const rate = useMutation(api.rides.rate);
  const respond = useMutation(api.rides.respond);
  const pay = useMutation(api.rides.pay);
  const [busy, setBusy] = useState(false);
  const [draftRating, setDraftRating] = useState(0);

  /** Quelle distance on suit : jusqu'au passager, ou jusqu'à la destination. */
  const [focus, setFocus] = useState<'pickup' | 'destination'>('pickup');

  const pickup = useMemo<LngLat | null>(
    () => (ride ? [ride.pickup.lng, ride.pickup.lat] : null),
    [ride],
  );

  const dropoff = useMemo<LngLat | null>(
    () => (ride?.destination ? [ride.destination.lng, ride.destination.lat] : null),
    [ride?.destination],
  );

  /** `true` quand on regarde la course elle-même, et non l'approche du chauffeur. */
  const onCourse = focus === 'destination' && !!dropoff;
  const target = onCourse ? dropoff : pickup;
  const driverPosition = ride?.driverPosition;

  /**
   * Point de départ du tracé : la position suivie du chauffeur, ou la sienne
   * propre s'il consulte la demande avant de l'accepter — aucune position n'est
   * encore enregistrée pour une course qui n'a pas de chauffeur attribué.
   *
   * Rafraîchi tous les 300 m parcourus : assez pour suivre une approche sans
   * marteler le service de routage.
   */
  const vehiclePositionLng = driverPosition?.lng ?? (ride?.asDriver ? geo.position?.lng : undefined);
  const vehiclePositionLat = driverPosition?.lat ?? (ride?.asDriver ? geo.position?.lat : undefined);
  const vehicleOrigin = useSettledOrigin(vehiclePositionLng, vehiclePositionLat, 300);

  /**
   * L'approche part du véhicule. La course, elle, part du point de prise en
   * charge tant qu'elle n'a pas démarré : c'est le trajet du client, celui qui
   * porte le tarif. Une fois en route, les deux sont ensemble et le véhicule
   * redevient l'origine — la distance restante devient la bonne mesure.
   */
  const courseFromVehicle = ride?.status === 'in_progress';
  const origin = onCourse && !courseFromVehicle ? pickup : vehicleOrigin;
  const { route } = useRoute(origin, target);

  /** Le tarif ne se calcule que sur la course, jamais sur l'approche. */
  const fare = useMemo(() => {
    if (!onCourse || !route || !ride?.vehicle) return null;
    const type = resolveVehicleType(ride.vehicle.type);
    return estimateFare(type, route.distanceM / 1000, route.durationS / 60);
  }, [onCourse, ride?.vehicle, route]);

  /** Le marqueur suit le point dont on mesure la distance. */
  const marker = useMemo<GeocodeFeature | null>(() => {
    if (!target) return null;
    const toDropoff = focus === 'destination' && dropoff;
    const name = toDropoff
      ? ride?.destinationName || 'Destination'
      : ride?.pickupName || 'Point de prise en charge';

    return {
      id: `ride:${rideId}:${focus}`,
      text: name,
      place_name: name,
      center: target,
      source: 'photon',
    };
  }, [dropoff, focus, ride?.destinationName, ride?.pickupName, rideId, target]);

  /** Le chauffeur est épinglé comme une voiture qui se déplace sur la carte. */
  const mapDrivers = useMemo<MapDriver[]>(
    () =>
      driverPosition
        ? [
            {
              id: 'ride-driver',
              label: ride?.driverName?.split(' ')[0] ?? 'Chauffeur',
              center: [driverPosition.lng, driverPosition.lat],
              demo: false,
              available: true,
            },
          ]
        : [],
    [driverPosition, ride?.driverName],
  );

  /**
   * Le passager s'intéresse d'abord à sa course (et à son prix), le chauffeur à
   * son approche. Posé une seule fois, à l'arrivée des données.
   */
  const focusInit = useRef(false);
  useEffect(() => {
    if (focusInit.current || !ride) return;
    focusInit.current = true;
    if (!ride.asDriver && ride.destination) setFocus('destination');
  }, [ride]);

  /**
   * Cadrage sur le trajet affiché — refait à chaque bascule, sinon on change de
   * tracé sans voir où il mène.
   */
  const framedFor = useRef<string | null>(null);
  useEffect(() => {
    if (route) {
      if (framedFor.current === focus) return;
      framedFor.current = focus;
      mapRef.current?.fitRoute(route.geometry.coordinates);
      return;
    }
    if (pickup && framedFor.current === null) {
      framedFor.current = focus;
      mapRef.current?.flyTo(pickup[0], pickup[1], FIRST_FIX_ZOOM);
    }
  }, [focus, pickup, route]);

  const run = useCallback(
    async (action: () => Promise<unknown>, failure: string) => {
      if (busy) return;
      setBusy(true);
      try {
        await action();
      } catch (error) {
        console.error(`[course] ${failure}`, error);
        Alert.alert('Action impossible', (error as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const askCancel = useCallback(() => {
    Alert.alert('Annuler la course ?', 'Cette action est définitive.', [
      { text: 'Retour', style: 'cancel' },
      {
        text: 'Annuler la course',
        style: 'destructive',
        onPress: () =>
          void run(() => cancel({ rideId: rideId as Id<'rides'> }), 'annulation impossible'),
      },
    ]);
  }, [cancel, rideId, run]);

  if (ride === undefined) {
    return (
      <View style={[styles.root, styles.centered]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  if (ride === null) {
    return (
      <View style={[styles.root, styles.centered, { paddingTop: insets.top }]}>
        <Text style={styles.empty}>Course introuvable.</Text>
        <Pressable onPress={() => router.back()} style={styles.ghost}>
          <Text style={styles.ghostLabel}>Retour</Text>
        </Pressable>
      </View>
    );
  }

  const vehicleType = ride.vehicle ? resolveVehicleType(ride.vehicle.type) : null;
  const active = isRideActive(ride.status);
  const statusColor = rideStatusColor(ride.status, colors);

  return (
    <View style={styles.root}>
      <NativeMap
        ref={mapRef}
        userPosition={geo.position}
        destination={marker}
        route={route}
        drivers={mapDrivers}
        selectedDriverId="ride-driver"
      />

      <View
        pointerEvents="box-none"
        style={[
          styles.overlay,
          {
            paddingTop: insets.top + 8,
            paddingBottom: Math.max(insets.bottom, 16),
            paddingHorizontal: 16,
          },
        ]}>
        <View style={styles.header}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Retour"
            onPress={() => router.back()}
            hitSlop={10}
            style={({ pressed }) => [styles.back, pressed && styles.pressed]}>
            <ChevronLeft size={24} color={colors.text} />
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {ride.asDriver ? ride.riderName : (ride.driverName ?? 'Chauffeur')}
          </Text>
          <View style={[styles.pill, { backgroundColor: rideStatusTint(ride.status, colors) }]}>
            <View style={[styles.dot, { backgroundColor: statusColor }]} />
            <Text style={[styles.pillLabel, { color: statusColor }]}>
              {rideStatusLabel(ride.status, ride.asDriver)}
            </Text>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.place}>
            <View style={styles.placeIcon}>
              <MapPin size={18} color={colors.accent} />
            </View>
            <View style={styles.placeTexts}>
              <Text style={styles.placeName} numberOfLines={2}>
                {onCourse
                  ? (ride.destinationName ?? 'Destination du passager')
                  : (ride.pickupName ?? 'Point de prise en charge')}
              </Text>
              <Text style={styles.coords}>
                {onCourse && ride.destination
                  ? `${ride.destination.lat.toFixed(5)}, ${ride.destination.lng.toFixed(5)}`
                  : `${ride.pickup.lat.toFixed(5)}, ${ride.pickup.lng.toFixed(5)}`}
              </Text>
            </View>
          </View>

          {/* Toujours visible, pour le chauffeur comme pour le passager : les deux
              suivent la même course et ont besoin des deux distances. */}
          <View style={styles.focusRow}>
            {(
              [
                { key: 'pickup' as const, label: 'Chauffeur → passager', Icon: MapPin },
                { key: 'destination' as const, label: 'Vers la destination', Icon: Flag },
              ]
            ).map((option) => {
              const usable = option.key === 'pickup' || !!dropoff;
              const on = focus === option.key && usable;

              return (
                <Pressable
                  key={option.key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on, disabled: !usable }}
                  disabled={!usable}
                  onPress={() => setFocus(option.key)}
                  style={({ pressed }) => [
                    styles.focusOption,
                    on && styles.focusOptionActive,
                    !usable && styles.focusOptionDisabled,
                    pressed && styles.pressed,
                  ]}>
                  <option.Icon
                    size={14}
                    color={on ? colors.accent : usable ? colors.textSecondary : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.focusLabel,
                      on && styles.focusLabelActive,
                      !usable && styles.focusLabelDisabled,
                    ]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {!dropoff ? (
            <Text style={styles.meta}>
              Aucune destination n&apos;était choisie au moment de la demande : seule la distance
              entre le chauffeur et le passager est suivie.
            </Text>
          ) : null}

          {vehicleType ? (
            <View style={styles.vehicleRow}>
              <CarFront size={16} color={colors.textSecondary} />
              <Text style={styles.vehicleLabel}>
                {vehicleType.label}
                {ride.vehicle?.plate ? ` · ${ride.vehicle.plate}` : ''}
              </Text>
            </View>
          ) : null}

          {route ? (
            <>
              <View style={styles.stats}>
                <View style={styles.stat}>
                  <RouteIcon size={16} color={colors.textSecondary} />
                  <Text style={styles.statValue}>{formatDistance(route.distanceM / 1000)}</Text>
                  <Text style={styles.statLabel}>
                    {onCourse ? 'de course' : 'jusqu’au passager'}
                  </Text>
                </View>
                <View style={styles.statDivider} />
                <View style={styles.stat}>
                  <Clock size={16} color={colors.textSecondary} />
                  <Text style={styles.statValue}>{formatDuration(route.durationS)}</Text>
                  <Text style={styles.statLabel}>{onCourse ? 'de trajet' : 'avant l’arrivée'}</Text>
                </View>
                {fare != null ? (
                  <>
                    <View style={styles.statDivider} />
                    <View style={styles.stat}>
                      <Wallet size={16} color={colors.textSecondary} />
                      <Text style={[styles.statValue, styles.fareValue]}>{formatXaf(fare)}</Text>
                      <Text style={styles.statLabel}>estimation</Text>
                    </View>
                  </>
                ) : null}
              </View>

              {onCourse && fare != null ? (
                <Text style={styles.meta}>
                  {`Tarif ${vehicleType?.tariffClass ?? 'Éco'} estimé avant course : l’attente et les détours réels ne sont pas comptés.`}
                </Text>
              ) : null}

              {onCourse && fare == null ? (
                <Text style={styles.meta}>
                  Aucun véhicule n&apos;est encore associé à cette course : le tarif sera estimé
                  dès qu&apos;un chauffeur l&apos;aura acceptée.
                </Text>
              ) : null}
            </>
          ) : active && ride.status !== 'requested' ? (
            <Text style={styles.meta}>
              En attente de la position du chauffeur — elle arrive dès qu&apos;il ouvre
              l&apos;application.
            </Text>
          ) : ride.canRespond && !geo.position ? (
            <Text style={styles.meta}>
              Active ta localisation pour mesurer le trajet avant de répondre.
            </Text>
          ) : null}

          {ride.status === 'requested' ? (
            <Text style={styles.meta}>
              {ride.canRespond
                ? 'Regarde le trajet, puis accepte ou refuse cette demande.'
                : ride.asDriver
                  ? 'Réponds à la demande depuis la discussion.'
                  : 'En attente de la réponse du chauffeur.'}
            </Text>
          ) : null}

          {/* Le chauffeur sollicité tranche ici, une fois le trajet consulté. */}
          {ride.canRespond ? (
            <View style={styles.actions}>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void run(
                    () => respond({ rideId: ride.id, accept: true }),
                    'acceptation impossible',
                  )
                }
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                <Text style={styles.primaryLabel}>Accepter la course</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void run(() => respond({ rideId: ride.id, accept: false }), 'refus impossible')
                }
                style={({ pressed }) => [styles.danger, pressed && styles.pressed]}>
                <Text style={styles.dangerLabel}>Refuser</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Le reçu se voit des deux côtés ; le formulaire n'est que pour le
              passager, qui doit régler avant de clore — `complete` le lui refuse sinon. */}
          {ride.payment ? (
            <RidePayment
              amount={ride.payment.amount}
              driverPhone={ride.driverPhone}
              driverName={ride.driverName ?? 'ton chauffeur'}
              paid={ride.payment}
              busy={false}
              onPay={() => undefined}
            />
          ) : !ride.asDriver && active && ride.status !== 'requested' ? (
            fare != null ? (
              <RidePayment
                amount={fare}
                driverPhone={ride.driverPhone}
                driverName={ride.driverName ?? 'ton chauffeur'}
                paid={null}
                busy={busy}
                onPay={(method: PaymentMethod) =>
                  void run(
                    () => pay({ rideId: ride.id, method, amount: fare }),
                    'paiement impossible',
                  )
                }
              />
            ) : (
              <Text style={styles.meta}>
                Bascule sur « Vers la destination » pour connaître le montant et régler la course.
              </Text>
            )
          ) : null}

          {ride.status === 'completed' && !ride.asDriver ? (
            <View style={styles.rating}>
              <Text style={styles.ratingTitle}>
                {ride.rating != null
                  ? `Tu as noté ${ride.driverName ?? 'ce chauffeur'}`
                  : `Comment s'est passée la course avec ${ride.driverName ?? 'ton chauffeur'} ?`}
              </Text>

              <View style={styles.stars}>
                <StarRating
                  value={ride.rating ?? draftRating}
                  onChange={ride.rating == null ? setDraftRating : undefined}
                  disabled={ride.rating != null || busy}
                />
              </View>

              {ride.rating == null ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={busy || draftRating <= 0}
                  onPress={() =>
                    void run(
                      () => rate({ rideId: ride.id, rating: draftRating }),
                      'notation impossible',
                    )
                  }
                  style={({ pressed }) => [
                    styles.primary,
                    draftRating <= 0 && styles.primaryDisabled,
                    pressed && styles.pressed,
                  ]}>
                  <Text
                    style={[
                      styles.primaryLabel,
                      draftRating <= 0 && styles.primaryLabelDisabled,
                    ]}>
                    {draftRating > 0
                      ? `Envoyer ${draftRating.toFixed(1).replace('.', ',')} / 5`
                      : 'Choisis une note'}
                  </Text>
                </Pressable>
              ) : (
                <Text style={[styles.meta, styles.ratingTitle]}>
                  {`Note enregistrée : ${ride.rating.toFixed(1).replace('.', ',')} / 5. Elle compte dans la moyenne du chauffeur.`}
                </Text>
              )}
            </View>
          ) : null}

          <View style={styles.actions}>
            {ride.conversationId ? (
              <Pressable
                accessibilityRole="button"
                onPress={() => router.push('/messages')}
                style={({ pressed }) => [styles.ghost, pressed && styles.pressed]}>
                <MessageSquare size={16} color={colors.text} />
                <Text style={styles.ghostLabel}>Discussion</Text>
              </Pressable>
            ) : null}

            {ride.asDriver && !ride.canRespond && ride.status === 'matched' ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={() =>
                  void run(() => start({ rideId: ride.id }), 'démarrage impossible')
                }
                style={({ pressed }) => [styles.primary, pressed && styles.pressed]}>
                <Text style={styles.primaryLabel}>Démarrer la course</Text>
              </Pressable>
            ) : null}

            {/* Ouvert aux deux parties dès que la course existe : celui qui
                constate la fin du trajet le premier peut clore. */}
            {active && !ride.canRespond ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy || (!ride.asDriver && !ride.payment)}
                onPress={() =>
                  void run(() => complete({ rideId: ride.id }), 'clôture impossible')
                }
                style={({ pressed }) => [
                  styles.primary,
                  !ride.asDriver && !ride.payment && styles.primaryDisabled,
                  pressed && styles.pressed,
                ]}>
                <Text
                  style={[
                    styles.primaryLabel,
                    !ride.asDriver && !ride.payment && styles.primaryLabelDisabled,
                  ]}>
                  {!ride.asDriver && !ride.payment
                    ? 'Règle la course pour la terminer'
                    : 'Terminer la course'}
                </Text>
              </Pressable>
            ) : null}

            {active && !ride.canRespond ? (
              <Pressable
                accessibilityRole="button"
                disabled={busy}
                onPress={askCancel}
                style={({ pressed }) => [styles.danger, pressed && styles.pressed]}>
                <Text style={styles.dangerLabel}>Annuler</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: c.background,
    },
    centered: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 16,
    },
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      backgroundColor: c.surface,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: c.border,
      paddingRight: 10,
      paddingVertical: 6,
    },
    back: {
      width: 36,
      height: 36,
      alignItems: 'center',
      justifyContent: 'center',
    },
    headerTitle: {
      color: c.text,
      fontSize: 15,
      fontWeight: '800',
      flexShrink: 1,
    },
    pill: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: 999,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
    },
    pillLabel: {
      fontSize: 11,
      fontWeight: '800',
    },
    card: {
      marginTop: 'auto',
      backgroundColor: c.surface,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 16,
      paddingVertical: 14,
      gap: 12,
    },
    place: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    placeIcon: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: c.accentSoft,
      alignItems: 'center',
      justifyContent: 'center',
    },
    placeTexts: {
      flex: 1,
      minWidth: 0,
      gap: 2,
    },
    placeName: {
      color: c.text,
      fontSize: 15,
      fontWeight: '700',
      lineHeight: 20,
    },
    coords: {
      color: c.textMuted,
      fontSize: 11,
    },
    vehicleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    vehicleLabel: {
      color: c.textSecondary,
      fontSize: 13,
      fontWeight: '600',
    },
    stats: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: c.surfaceMuted,
      borderRadius: 14,
      paddingVertical: 10,
    },
    stat: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
    },
    statDivider: {
      width: StyleSheet.hairlineWidth,
      alignSelf: 'stretch',
      backgroundColor: c.border,
    },
    statValue: {
      color: c.text,
      fontSize: 16,
      fontWeight: '800',
    },
    fareValue: {
      color: c.accent,
      fontSize: 14,
    },
    statLabel: {
      color: c.textMuted,
      fontSize: 11,
    },
    meta: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    empty: {
      color: c.textSecondary,
      fontSize: 15,
    },
    focusRow: {
      flexDirection: 'row',
      gap: 8,
    },
    focusOption: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 38,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
    },
    focusOptionActive: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    focusOptionDisabled: {
      opacity: 0.5,
    },
    focusLabel: {
      color: c.textSecondary,
      fontSize: 12,
      fontWeight: '700',
    },
    focusLabelActive: {
      color: c.accent,
    },
    focusLabelDisabled: {
      color: c.textMuted,
    },
    rating: {
      gap: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
      paddingTop: 14,
    },
    stars: {
      alignItems: 'center',
    },
    ratingTitle: {
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
      textAlign: 'center',
    },
    actions: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    primary: {
      flexGrow: 1,
      alignItems: 'center',
      justifyContent: 'center',
      height: 46,
      borderRadius: 14,
      backgroundColor: c.accent,
      paddingHorizontal: 16,
    },
    primaryLabel: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: '800',
    },
    primaryDisabled: {
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
    },
    primaryLabelDisabled: {
      color: c.textMuted,
    },
    ghost: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      height: 46,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      paddingHorizontal: 16,
    },
    ghostLabel: {
      color: c.text,
      fontSize: 14,
      fontWeight: '700',
    },
    danger: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 46,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.dangerBorder,
      backgroundColor: c.dangerBg,
      paddingHorizontal: 16,
    },
    dangerLabel: {
      color: c.danger,
      fontSize: 14,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.75,
    },
  });
