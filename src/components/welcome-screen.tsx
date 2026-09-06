import { useSSO } from '@clerk/expo/experimental';
import * as AuthSession from 'expo-auth-session';
import * as SplashScreen from 'expo-splash-screen';
import * as WebBrowser from 'expo-web-browser';
import { useCallback, useEffect, useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';

import {
  PrimaryButton,
  SecondaryButton,
  TextLink,
} from '@/components/auth/auth-form-kit';
import { AuthShell } from '@/components/auth/auth-shell';
import { EmailAuthForm, type EmailAuthMode } from '@/components/auth/email-auth-form';
import { useWarmUpBrowser } from '@/hooks/use-warm-up-browser';

WebBrowser.maybeCompleteAuthSession();

type Screen = 'landing' | EmailAuthMode;

export function WelcomeScreen() {
  useWarmUpBrowser();
  const { startSSOFlow } = useSSO();
  const [screen, setScreen] = useState<Screen>('landing');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  const signInWithGoogle = useCallback(async () => {
    if (isSubmitting) {
      return;
    }

    setIsSubmitting(true);
    try {
      const { createdSessionId } = await startSSOFlow({
        strategy: 'oauth_google',
        redirectUrl: AuthSession.makeRedirectUri({ scheme: 'vora' }),
      });

      // Clerk 4 active la session automatiquement après un SSO réussi.
      if (createdSessionId) {
        return;
      }

      Alert.alert(
        'Connexion incomplète',
        "Google a répondu, mais Clerk a besoin d'informations supplémentaires. Vérifie que Google est bien activé dans le dashboard Clerk.",
      );
    } catch (error) {
      console.error(JSON.stringify(error, null, 2));
      Alert.alert('Connexion impossible', 'Réessaie dans un instant.');
    } finally {
      setIsSubmitting(false);
    }
  }, [isSubmitting, startSSOFlow]);

  if (screen !== 'landing') {
    return (
      <EmailAuthForm
        mode={screen}
        onBack={() => setScreen('landing')}
        onSwitchMode={setScreen}
      />
    );
  }

  return (
    <AuthShell>
      <Text style={styles.headline}>{`Ta course, à ta façon.\nAvec Vora.`}</Text>

      <PrimaryButton
        label="S'inscrire gratuitement"
        onPress={() => setScreen('signUp')}
        disabled={isSubmitting}
      />

      <SecondaryButton
        label="Continuer avec Google"
        onPress={() => void signInWithGoogle()}
        pending={isSubmitting}
        icon={
          <View style={styles.googleIcon}>
            <Text style={styles.googleG}>G</Text>
          </View>
        }
      />

      <TextLink
        label="Se connecter"
        onPress={() => setScreen('signIn')}
        disabled={isSubmitting}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  headline: {
    color: '#fff',
    fontSize: 30,
    lineHeight: 36,
    fontWeight: '800',
    textAlign: 'center',
    marginBottom: 10,
  },
  googleIcon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'absolute',
    left: 22,
  },
  googleG: {
    color: '#4285F4',
    fontSize: 14,
    fontWeight: '800',
  },
});
