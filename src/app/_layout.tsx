import { ClerkProvider, useAuth } from '@clerk/expo';
import { tokenCache } from '@clerk/expo/token-cache';
import { ConvexReactClient, useQuery } from 'convex/react';
import { ConvexProviderWithClerk } from 'convex/react-clerk';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { GeolocationProvider } from '@/hooks/use-geo';
import { AppThemeProvider, useAppTheme } from '@/hooks/use-app-theme';
import { OnboardingScreen } from '@/components/onboarding-screen';
import { WelcomeScreen } from '@/components/welcome-screen';
import { useStoreUser } from '@/hooks/use-store-user';
import { api } from '../../convex/_generated/api';

SplashScreen.preventAutoHideAsync();

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!publishableKey) {
  throw new Error('Ajoute EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY dans le fichier .env');
}

if (!convexUrl) {
  throw new Error('Ajoute EXPO_PUBLIC_CONVEX_URL dans le fichier .env.local (npx convex dev)');
}

// `unsavedChangesWarning` n'a de sens que dans un navigateur : inutile en natif.
const convex = new ConvexReactClient(convexUrl, { unsavedChangesWarning: false });

/** Écran d'attente sobre, sous le splash tant que celui-ci n'est pas masqué. */
function LoadingScreen() {
  const { colors } = useAppTheme();
  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <ActivityIndicator color={colors.accent} size="large" />
    </View>
  );
}

/** `syncUser` a échoué (réseau, Convex injoignable) : on propose de réessayer. */
function SyncErrorScreen({ onRetry }: { onRetry: () => void }) {
  const { colors } = useAppTheme();

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  return (
    <View style={[styles.centered, { backgroundColor: colors.background }]}>
      <Text style={[styles.errorTitle, { color: colors.text }]}>
        Connexion au serveur impossible
      </Text>
      <Text style={[styles.errorText, { color: colors.textSecondary }]}>
        Ton compte est bien créé, mais ton profil Vora n&apos;a pas pu être chargé.
      </Text>
      <Pressable
        accessibilityRole="button"
        onPress={onRetry}
        style={({ pressed }) => [
          styles.retry,
          { backgroundColor: colors.accent },
          pressed && styles.pressed,
        ]}>
        <Text style={[styles.retryLabel, { color: colors.onAccent }]}>Réessayer</Text>
      </Pressable>
    </View>
  );
}

/**
 * Utilisateur connecté à Clerk : on s'assure qu'il existe côté Convex, puis on
 * l'envoie sur l'onboarding tant que son rôle n'est pas choisi.
 */
function AuthedApp() {
  const { scheme, colors } = useAppTheme();
  const { status, retry } = useStoreUser();
  const me = useQuery(api.users.getMe);

  if (status === 'error') {
    return <SyncErrorScreen onRetry={retry} />;
  }

  // `undefined` = requête en cours, `null` = ligne `users` pas encore créée.
  if (me === undefined || me === null) {
    return <LoadingScreen />;
  }

  if (!me.role) {
    return <OnboardingScreen initialName={me.name} />;
  }

  return (
    <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
      {/* Une seule veille GPS pour toute l'app authentifiée, et l'enregistrement
          périodique de la position en base. */}
      <GeolocationProvider>
        <AnimatedSplashOverlay />
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: colors.background },
          }}
        />
      </GeolocationProvider>
    </ThemeProvider>
  );
}

function RootContent() {
  const { scheme } = useAppTheme();
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <LoadingScreen />
      </>
    );
  }

  // L'entrée (accueil + onboarding) reste sur son fond sombre de marque.
  if (!isSignedIn) {
    return (
      <>
        <StatusBar style="light" />
        <WelcomeScreen />
      </>
    );
  }

  return (
    <>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <AuthedApp />
    </>
  );
}

export default function RootLayout() {
  return (
    <ClerkProvider publishableKey={publishableKey!} tokenCache={tokenCache}>
      <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
        <AppThemeProvider>
          <RootContent />
        </AppThemeProvider>
      </ConvexProviderWithClerk>
    </ClerkProvider>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
    gap: 12,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: '800',
    textAlign: 'center',
  },
  errorText: {
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
  },
  retry: {
    marginTop: 12,
    height: 48,
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  retryLabel: {
    fontSize: 16,
    fontWeight: '800',
  },
  pressed: {
    opacity: 0.75,
  },
});
