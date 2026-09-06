import { useSignIn, useSignUp } from '@clerk/expo';
import { useCallback, useState } from 'react';
import { StyleSheet, Text } from 'react-native';

import {
  AuthField,
  FormError,
  PrimaryButton,
  TextLink,
} from '@/components/auth/auth-form-kit';
import { AuthShell } from '@/components/auth/auth-shell';
import { authErrorMessage } from '@/lib/errors';

export type EmailAuthMode = 'signUp' | 'signIn';

const MIN_PASSWORD_LENGTH = 8;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const COPY = {
  signUp: {
    title: 'Crée ton compte',
    subtitle: 'Une adresse e-mail et un mot de passe suffisent.',
    submit: "S'inscrire",
    switch: 'Déjà un compte ? Se connecter',
  },
  signIn: {
    title: 'Content de te revoir',
    subtitle: 'Connecte-toi avec ton adresse e-mail.',
    submit: 'Se connecter',
    switch: "Pas encore de compte ? S'inscrire",
  },
} as const;

type Props = {
  mode: EmailAuthMode;
  onBack: () => void;
  onSwitchMode: (mode: EmailAuthMode) => void;
};

/**
 * Flux e-mail complet (API « signals » de Clerk 4) :
 * inscription -> code de vérification à 6 chiffres -> session active,
 * ou connexion directe e-mail + mot de passe.
 *
 * Aucune navigation ici : `finalize()` active la session et `_layout` bascule
 * automatiquement vers l'onboarding.
 */
export function EmailAuthForm({ mode, onBack, onSwitchMode }: Props) {
  const { isLoaded: signUpLoaded, signUp } = useSignUp();
  const { isLoaded: signInLoaded, signIn } = useSignIn();
  const clerkReady = signUpLoaded && signInLoaded;

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [awaitingCode, setAwaitingCode] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = COPY[mode];

  /** Validation locale : évite un aller-retour réseau pour une faute évidente. */
  const validateCredentials = useCallback(() => {
    if (!EMAIL_PATTERN.test(email.trim())) return 'Adresse e-mail invalide.';
    if (!password) return 'Mot de passe requis.';
    if (mode === 'signUp' && password.length < MIN_PASSWORD_LENGTH) {
      return `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`;
    }
    return null;
  }, [email, mode, password]);

  const submitCredentials = useCallback(async () => {
    if (pending || !clerkReady) return;

    const localError = validateCredentials();
    if (localError) {
      setError(localError);
      return;
    }

    setPending(true);
    setError(null);

    try {
      const emailAddress = email.trim();

      if (mode === 'signIn') {
        const { error: signInError } = await signIn.password({ emailAddress, password });
        if (signInError) {
          setError(authErrorMessage(signInError));
          return;
        }

        if (signIn.status !== 'complete') {
          setError(
            "Cette connexion demande une vérification supplémentaire, non gérée pour l'instant.",
          );
          return;
        }

        const { error: finalizeError } = await signIn.finalize();
        if (finalizeError) setError(authErrorMessage(finalizeError));
        return;
      }

      const { error: signUpError } = await signUp.password({ emailAddress, password });
      if (signUpError) {
        setError(authErrorMessage(signUpError));
        return;
      }

      // Instance Clerk sans vérification e-mail : le compte est déjà complet.
      if (signUp.status === 'complete') {
        const { error: finalizeError } = await signUp.finalize();
        if (finalizeError) setError(authErrorMessage(finalizeError));
        return;
      }

      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) {
        setError(authErrorMessage(sendError));
        return;
      }

      setAwaitingCode(true);
    } finally {
      setPending(false);
    }
  }, [clerkReady, email, mode, password, pending, signIn, signUp, validateCredentials]);

  const submitCode = useCallback(async () => {
    if (pending || !clerkReady) return;

    const cleanCode = code.trim();
    if (cleanCode.length < 6) {
      setError('Saisis les 6 chiffres reçus par e-mail.');
      return;
    }

    setPending(true);
    setError(null);

    try {
      const { error: verifyError } = await signUp.verifications.verifyEmailCode({
        code: cleanCode,
      });
      if (verifyError) {
        setError(authErrorMessage(verifyError));
        return;
      }

      if (signUp.status !== 'complete') {
        setError('Il manque encore des informations pour créer le compte.');
        return;
      }

      const { error: finalizeError } = await signUp.finalize();
      if (finalizeError) setError(authErrorMessage(finalizeError));
    } finally {
      setPending(false);
    }
  }, [clerkReady, code, pending, signUp]);

  const resendCode = useCallback(async () => {
    if (pending) return;

    setPending(true);
    setError(null);
    try {
      const { error: sendError } = await signUp.verifications.sendEmailCode();
      if (sendError) setError(authErrorMessage(sendError));
    } finally {
      setPending(false);
    }
  }, [pending, signUp]);

  /** Retour depuis l'étape code : on repart d'une inscription vierge. */
  const backToCredentials = useCallback(() => {
    setAwaitingCode(false);
    setCode('');
    setError(null);
    void signUp.reset();
  }, [signUp]);

  const switchMode = useCallback(() => {
    setError(null);
    setPassword('');
    onSwitchMode(mode === 'signUp' ? 'signIn' : 'signUp');
  }, [mode, onSwitchMode]);

  if (awaitingCode) {
    return (
      <AuthShell variant="compact" onBack={backToCredentials}>
        <Text style={styles.title}>Vérifie ton e-mail</Text>
        <Text style={styles.subtitle}>
          {`Nous avons envoyé un code à 6 chiffres à\n${email.trim()}`}
        </Text>

        <FormError message={error} />

        <AuthField
          label="Code de vérification"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          keyboardType="number-pad"
          textContentType="oneTimeCode"
          autoComplete="one-time-code"
          maxLength={6}
          editable={!pending}
          returnKeyType="done"
          onSubmitEditing={() => void submitCode()}
        />

        <PrimaryButton
          label="Confirmer"
          onPress={() => void submitCode()}
          pending={pending}
          disabled={!clerkReady}
        />
        <TextLink label="Renvoyer le code" onPress={() => void resendCode()} disabled={pending} />
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="compact" onBack={onBack}>
      <Text style={styles.title}>{copy.title}</Text>
      <Text style={styles.subtitle}>{copy.subtitle}</Text>

      <FormError message={error} />

      <AuthField
        label="Adresse e-mail"
        value={email}
        onChangeText={setEmail}
        placeholder="toi@exemple.com"
        keyboardType="email-address"
        autoCapitalize="none"
        autoCorrect={false}
        autoComplete="email"
        textContentType="emailAddress"
        editable={!pending}
        returnKeyType="next"
      />

      <AuthField
        label="Mot de passe"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        secureTextEntry
        autoCapitalize="none"
        autoComplete={mode === 'signUp' ? 'new-password' : 'current-password'}
        textContentType={mode === 'signUp' ? 'newPassword' : 'password'}
        editable={!pending}
        returnKeyType="done"
        onSubmitEditing={() => void submitCredentials()}
        hint={mode === 'signUp' ? `${MIN_PASSWORD_LENGTH} caractères minimum` : undefined}
      />

      <PrimaryButton
        label={copy.submit}
        onPress={() => void submitCredentials()}
        pending={pending}
        disabled={!clerkReady}
      />
      <TextLink label={copy.switch} onPress={switchMode} disabled={pending} />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  title: {
    color: '#fff',
    fontSize: 26,
    fontWeight: '800',
    textAlign: 'center',
  },
  subtitle: {
    color: '#b3b3b3',
    fontSize: 15,
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 4,
  },
});
