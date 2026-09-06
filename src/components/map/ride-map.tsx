import { useQuery } from 'convex/react';
import { router } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { VoraPalette } from '@/constants/theme';
import { useGeo } from '@/hooks/use-geo';
import { InboxButton } from '@/components/inbox-button';
import { DriverSuggestions } from '@/components/map/driver-suggestions';
import { MapOverlay } from '@/components/map/map-overlay';
import { NativeMap } from '@/components/map/native-map';
import type { MapCameraHandle, MapDriver } from '@/components/map/native-map-shared';
import { PlaceSearch } from '@/components/map/place-search';
import { RouteInfoCard } from '@/components/map/route-info-card';
import { useAppTheme } from '@/hooks/use-app-theme';
import { useDrivers } from '@/hooks/use-drivers';
import { useRoute } from '@/hooks/use-route';
import { useSettledOrigin } from '@/hooks/use-settled-origin';
import type { RideDriver } from '@/lib/drivers';
import type { GeocodeFeature } from '@/lib/geocoding';
import { DRIVER_FOCUS_ZOOM, FIRST_FIX_ZOOM } from '@/lib/map';
import type { LngLat } from '@/lib/routing';
import { resolveVehicleType } from '@/lib/vehicles';
import { api } from '../../../convex/_generated/api';

/**
 * Carte plein écran après auth + onboarding :
 * GPS au premier chargement, recherche, itinéraire, prix — et, pour un profil
 * passager, la liste des chauffeurs suggérés dès qu'une destination est posée.
 */
export function RideMapScreen() {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapCameraHandle>(null);
  const geo = useGeo();
  const hasCenteredOnce = useRef(false);
  const [destination, setDestination] = useState<GeocodeFeature | null>(null);
  /**
   * Point de prise en charge, **figé** quand la destination est choisie.
   * Sans ça le GPS repoussait un nouveau départ tous les 60 m parcourus et
   * relançait un appel ORS à chaque fois — l'API était appelée en continu.
   * Il n'est rafraîchi que sur action explicite (bouton « me recentrer »).
   */
  const [pickup, setPickup] = useState<LngLat | null>(null);
  const [driver, setDriver] = useState<RideDriver | null>(null);
  const me = useQuery(api.users.getMe);
  const isRider = me?.role === 'rider';

  const posLng = geo.position?.lng;
  const posLat = geo.position?.lat;

  const proximity: [number, number] =
    posLng != null && posLat != null ? [posLng, posLat] : [11.5021, 3.848];

  const routeOrigin = useSettledOrigin(posLng, posLat);
  const routeDest = destination ? destination.center : null;
  const { route, status: routeStatus } = useRoute(pickup, routeDest);
  const { drivers, loading: driversLoading } = useDrivers(routeOrigin);

  /** Chauffeurs localisés : profils de test et vrais comptes ayant une position connue. */
  const mapDrivers = useMemo<MapDriver[]>(
    () =>
      drivers
        .filter((item) => item.position)
        .map((item) => ({
          id: item.id,
          label: item.name.split(' ')[0],
          center: item.position!,
          demo: item.demo,
          available: item.isAvailable,
        })),
    [drivers],
  );

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  // Destination choisie avant le premier point GPS : on pose le départ à l'arrivée du fix.
  useEffect(() => {
    if (destination && !pickup && routeOrigin) setPickup(routeOrigin);
  }, [destination, pickup, routeOrigin]);

  const geoPositionRef = useRef(geo.position);
  useEffect(() => {
    geoPositionRef.current = geo.position;
  }, [geo.position]);

  const flyToPosition = useCallback((zoom = FIRST_FIX_ZOOM) => {
    const pos = geoPositionRef.current;
    if (!pos) return;
    mapRef.current?.flyTo(pos.lng, pos.lat, zoom);
  }, []);

  /** Recentrage : seul geste qui redemande un itinéraire depuis la position courante. */
  const recenter = useCallback(() => {
    flyToPosition();
    const pos = geoPositionRef.current;
    if (pos && destination) setPickup([pos.lng, pos.lat]);
  }, [destination, flyToPosition]);

  useEffect(() => {
    if (geo.position && !hasCenteredOnce.current) {
      hasCenteredOnce.current = true;
      flyToPosition();
    }
  }, [flyToPosition, geo.position]);

  /**
   * Cadrage une seule fois par destination : refaire un `fitBounds` à chaque
   * recalcul faisait sauter la caméra pendant le trajet.
   */
  const fittedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!route || !destination) return;
    const key = `${destination.center[0]},${destination.center[1]}`;
    if (fittedFor.current === key) return;
    fittedFor.current = key;
    mapRef.current?.fitRoute(route.geometry.coordinates);
  }, [destination, route]);

  const handlePlaceSelect = useCallback((place: GeocodeFeature) => {
    setDestination(place);
    setDriver(null);
    fittedFor.current = null;
    const pos = geoPositionRef.current;
    if (pos) setPickup([pos.lng, pos.lat]);
    mapRef.current?.flyTo(place.center[0], place.center[1], FIRST_FIX_ZOOM);
  }, []);

  const clearDestination = useCallback(() => {
    setDestination(null);
    setPickup(null);
    setDriver(null);
    fittedFor.current = null;
  }, []);

  const toggleDriver = useCallback(
    (next: RideDriver) => {
      const deselect = driver?.id === next.id;
      setDriver(deselect ? null : next);
      // Un chauffeur sans position (profil Convex hors course) n'est pas localisable.
      if (!deselect && next.position) {
        mapRef.current?.flyTo(next.position[0], next.position[1], DRIVER_FOCUS_ZOOM);
      }
    },
    [driver],
  );

  /** Ouvre le fil de discussion dédié au chauffeur. */
  const openChat = useCallback((next: RideDriver) => {
    const type = resolveVehicleType(next.vehicle?.type ?? '');
    const plate = next.vehicle?.plate ? ` · ${next.vehicle.plate}` : '';
    router.push({
      pathname: '/chat/[driverKey]',
      params: { driverKey: next.id, name: next.name, vehicle: `${type.label}${plate}` },
    });
  }, []);

  const driverVehicle = driver ? resolveVehicleType(driver.vehicle?.type ?? '') : null;

  return (
    <View style={styles.root}>
      <NativeMap
        ref={mapRef}
        userPosition={geo.position}
        destination={destination}
        route={route}
        drivers={mapDrivers}
        selectedDriverId={driver?.id ?? null}
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
        <View style={styles.searchBar}>
          <PlaceSearch
            onSelect={handlePlaceSelect}
            proximity={proximity}
            origin={geo.position ? [geo.position.lng, geo.position.lat] : undefined}
            selected={destination}
            onClear={clearDestination}
            trailing={
              <View style={styles.trailingButtons}>
                <InboxButton />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Mon compte"
                  onPress={() => router.push('/profile')}
                  hitSlop={8}
                  style={({ pressed }) => [styles.profile, pressed && styles.pressed]}>
                  <Text style={styles.profileLabel}>
                    {(me?.name ?? '?').charAt(0).toUpperCase()}
                  </Text>
                </Pressable>
              </View>
            }
          />
        </View>

        <MapOverlay geo={geo} onRecenter={recenter} raised={!!destination} />

        {destination ? (
          <View style={styles.bottom}>
            {isRider ? (
              <DriverSuggestions
                drivers={drivers}
                loading={driversLoading}
                route={route}
                selectedId={driver?.id ?? null}
                onSelect={toggleDriver}
                onMessage={openChat}
              />
            ) : null}
            <RouteInfoCard
              route={route}
              loading={routeStatus === 'loading'}
              onClear={clearDestination}
              vehicle={driverVehicle}
              showFareChips={!isRider}
            />
          </View>
        ) : null}
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
    overlay: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    searchBar: {
      alignSelf: 'stretch',
      zIndex: 3,
    },
    trailingButtons: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
    },
    profile: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: c.surfaceStrong,
      borderWidth: 1,
      borderColor: c.borderStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    profileLabel: {
      color: c.accent,
      fontSize: 14,
      fontWeight: '800',
    },
    pressed: {
      opacity: 0.75,
    },
    bottom: {
      marginTop: 'auto',
      zIndex: 2,
    },
  });
