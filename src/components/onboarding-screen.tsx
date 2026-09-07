import { useClerk } from '@clerk/expo';
import { useMutation, useQuery } from 'convex/react';
import * as SplashScreen from 'expo-splash-screen';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  AuthField,
  FormError,
  PrimaryButton,
  TextLink,
} from '@/components/auth/auth-form-kit';
import { AuthShell } from '@/components/auth/auth-shell';
import { notifyLocally } from '@/lib/notifications';
import { convexErrorMessage } from '@/lib/errors';
import {
  OPERATOR_LABEL,
  PHONE_DIGITS,
  PHONE_PREFIX,
  phoneError,
  phoneOperator,
} from '@/lib/phone';
import { api } from '../../convex/_generated/api';

/** Doit rester aligné sur `MIN_NAME_LENGTH` / `MAX_NAME_LENGTH` (convex/users.ts). */
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 40;
const MIN_PLATE_LENGTH = 4;

type Role = 'rider' | 'driver';
type Step = 'role' | 'profile';

const ROLES: { value: Role; glyph: string; title: string; description: string }[] = [
  {
    value: 'rider',
    glyph: '🧍',
    title: 'Passager',
    description: 'Je commande des courses et je suis mon chauffeur en temps réel.',
  },
  {
    value: 'driver',
    glyph: '🚗',
    title: 'Chauffeur',
    description: 'Je conduis avec mon véhicule et je reçois des demandes de course.',
  },
];

/** Suggestions de types de véhicule : un tap remplit le champ, qui reste libre. */
const VEHICLE_SUGGESTIONS = ['Berline', 'SUV', 'Van', 'Moto-taxi'];

/**
 * Onboarding affiché une seule fois, juste après la création du compte :
 * rôle, nom d'utilisateur, et véhicule pour les chauffeurs.
 *
 * Tout part dans une seule mutation `completeOnboarding` — dès que `users.role`
 * est renseigné, `_layout` bascule sur l'application.
 */
export function OnboardingScreen({ initialName = '' }: { initialName?: string }) {
  const { signOut } = useClerk();
  const completeOnboarding = useMutation(api.users.completeOnboarding);

  const [step, setStep] = useState<Step>('role');
  const [role, setRole] = useState<Role | null>(null);
  const [name, setName] = useState(initialName);
  const [phone, setPhone] = useState('');
  const [vehicleType, setVehicleType] = useState('');
  const [plate, setPlate] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Retour immédiat sur l'opérateur reconnu — ou sur ce qui cloche. */
  const phoneHint = (() => {
    const operator = phoneOperator(phone);
    if (operator) return `Numéro ${OPERATOR_LABEL[operator]} reconnu.`;
    if (phone.replace(/\D/g, '').length === PHONE_DIGITS) {
      return 'Ni Orange ni MTN : ce numéro ne peut ni payer ni être payé.';
    }
    return role === 'driver'
      ? 'Les passagers y transféreront le montant de leurs courses.'
      : 'Sert à te joindre et à régler tes courses.';
  })();

  const nameTaken = useQuery(
    api.users.isNameTaken,
    name.trim().length >= MIN_NAME_LENGTH ? { name } : 'skip',
  );

  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);

  const goToProfile = useCallback(() => {
    if (!role) {
      setError('Choisis un profil pour continuer.');
      return;
    }
    setError(null);
    setStep('profile');
  }, [role]);

  /** Mêmes règles que la mutation : on évite un aller-retour pour rien. */
  const validateProfile = useCallback(() => {
    const cleanName = name.trim();
    if (cleanName.length < MIN_NAME_LENGTH || cleanName.length > MAX_NAME_LENGTH) {
      return `Le nom doit faire entre ${MIN_NAME_LENGTH} et ${MAX_NAME_LENGTH} caractères.`;
    }
    if (nameTaken) return "Ce nom d'utilisateur est déjà pris.";

    // Mêmes règles que `convex/model/phone.ts`, pour un retour immédiat.
    const phoneProblem = phoneError(phone);
    if (phoneProblem) return phoneProblem;

    if (role === 'driver') {
      if (!vehicleType.trim()) return 'Indique le type de ton véhicule.';
      if (plate.trim().length < MIN_PLATE_LENGTH) return "Plaque d'immatriculation invalide.";
    }
    return null;
  }, [name, nameTaken, phone, plate, role, vehicleType]);

  const submit = useCallback(async () => {
    if (pending || !role) return;

    const localError = validateProfile();
    if (localError) {
      setError(localError);
      return;
    }

    setPending(true);
    setError(null);

    try {
      await completeOnboarding({
        role,
        name: name.trim(),
        phone: phone.trim(),
        vehicle:
          role === 'driver'
            ? { type: vehicleType.trim(), plate: plate.trim().toUpperCase() }
            : undefined,
      });
      // Succès : `getMe` se met à jour tout seul et `_layout` affiche l'app.
      void notifyLocally(
        'Bienvenue sur Vora',
        `Ton compte ${role === 'driver' ? 'chauffeur' : 'passager'} est prêt.`,
      );
    } catch (mutationError) {
      setError(
        convexErrorMessage(
          mutationError,
          "Impossible d'enregistrer ton profil. Réessaie dans un instant.",
        ),
      );
    } finally {
      setPending(false);
    }
  }, [completeOnboarding, name, pending, phone, plate, role, validateProfile, vehicleType]);

  if (step === 'role') {
    return (
      <AuthShell>
        <Text style={styles.title}>Bienvenue sur Vora</Text>
        <Text style={styles.subtitle}>Dis-nous comment tu comptes utiliser l&apos;application.</Text>

        <FormError message={error} />

        <View style={styles.roleList}>
          {ROLES.map((option) => {
            const selected = role === option.value;
            return (
              <Pressable
                key={option.value}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => {
                  setRole(option.value);
                  setError(null);
                }}
                style={({ pressed }) => [
                  styles.roleCard,
                  selected && styles.roleCardSelected,
                  pressed && styles.pressed,
                ]}>
                <Text style={styles.roleGlyph}>{option.glyph}</Text>
                <View style={styles.roleTexts}>
                  <Text style={styles.roleTitle}>{option.title}</Text>
                  <Text style={styles.roleDescription}>{option.description}</Text>
                </View>
                <View style={[styles.radio, selected && styles.radioSelected]} />
              </Pressable>
            );
          })}
        </View>

        <PrimaryButton label="Continuer" onPress={goToProfile} disabled={!role} />
        <TextLink label="Se déconnecter" onPress={() => void signOut()} />
      </AuthShell>
    );
  }

  return (
    <AuthShell variant="compact" onBack={() => setStep('role')}>
      <Text style={styles.title}>
        {role === 'driver' ? 'Ton profil chauffeur' : 'Ton profil passager'}
      </Text>
      <Text style={styles.subtitle}>
        {role === 'driver'
          ? 'Choisis ton nom et ajoute les infos de ton véhicule.'
          : 'Choisis le nom que les chauffeurs verront.'}
      </Text>

      <FormError message={error} />

      <AuthField
        label="Nom d'utilisateur"
        value={name}
        onChangeText={setName}
        placeholder="Ex. Maxime D."
        autoCapitalize="words"
        autoCorrect={false}
        maxLength={MAX_NAME_LENGTH}
        editable={!pending}
        returnKeyType={role === 'driver' ? 'next' : 'done'}
        hint={
          nameTaken
            ? "Ce nom d'utilisateur est déjà pris"
            : `Entre ${MIN_NAME_LENGTH} et ${MAX_NAME_LENGTH} caractères`
        }
      />

      <AuthField
        label="Numéro de téléphone"
        prefix={PHONE_PREFIX}
        value={phone}
        onChangeText={(text) => setPhone(text.replace(/\D/g, '').slice(0, PHONE_DIGITS))}
        placeholder="6 XX XX XX XX"
        keyboardType="phone-pad"
        autoCorrect={false}
        editable={!pending}
        returnKeyType={role === 'driver' ? 'next' : 'done'}
        hint={phoneHint}
      />

      {role === 'driver' ? (
        <>
          <AuthField
            label="Type de véhicule"
            value={vehicleType}
            onChangeText={setVehicleType}
            placeholder="Ex. Berline"
            autoCapitalize="words"
            autoCorrect={false}
            maxLength={30}
            editable={!pending}
            returnKeyType="next"
          />

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={styles.chipRow}
            style={styles.chipScroll}>
            {VEHICLE_SUGGESTIONS.map((suggestion) => {
              const selected = vehicleType.trim().toLowerCase() === suggestion.toLowerCase();
              return (
                <Pressable
                  key={suggestion}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setVehicleType(suggestion)}
                  disabled={pending}
                  style={({ pressed }) => [
                    styles.chip,
                    selected && styles.chipSelected,
                    pressed && styles.pressed,
                  ]}>
                  <Text style={[styles.chipLabel, selected && styles.chipLabelSelected]}>
                    {suggestion}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          <AuthField
            label="Plaque d'immatriculation"
            value={plate}
            onChangeText={(text) => setPlate(text.toUpperCase())}
            placeholder="AA-123-BB"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={12}
            editable={!pending}
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
          />
        </>
      ) : null}

      <PrimaryButton
        label="Terminer"
        onPress={() => void submit()}
        pending={pending}
        disabled={!!nameTaken}
      />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  title: {
    color: '#fff',
    fontSize: 28,
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
  roleList: {
    alignSelf: 'stretch',
    gap: 12,
  },
  roleCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    backgroundColor: '#121212',
    paddingVertical: 16,
    paddingHorizontal: 16,
  },
  roleCardSelected: {
    borderColor: '#1ED760',
    backgroundColor: 'rgba(30,215,96,0.10)',
  },
  roleGlyph: {
    fontSize: 26,
  },
  roleTexts: {
    flex: 1,
    gap: 2,
  },
  roleTitle: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '800',
  },
  roleDescription: {
    color: '#9a9a9a',
    fontSize: 13,
    lineHeight: 18,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: '#5a5a5a',
  },
  radioSelected: {
    borderColor: '#1ED760',
    backgroundColor: '#1ED760',
  },
  chipScroll: {
    alignSelf: 'stretch',
    marginTop: -4,
  },
  chipRow: {
    gap: 8,
    paddingRight: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    backgroundColor: '#121212',
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  chipSelected: {
    borderColor: '#1ED760',
    backgroundColor: 'rgba(30,215,96,0.12)',
  },
  chipLabel: {
    color: '#b3b3b3',
    fontSize: 14,
    fontWeight: '700',
  },
  chipLabelSelected: {
    color: '#1ED760',
  },
  pressed: {
    opacity: 0.75,
  },
});
