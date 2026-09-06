import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from 'react-native';

/** Champ de saisie sombre, aligné sur les boutons de l'accueil. */
export function AuthField({
  label,
  hint,
  ...inputProps
}: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.fieldWrapper}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        placeholderTextColor="#6f6f6f"
        selectionColor="#1ED760"
        {...inputProps}
        style={[styles.input, inputProps.style]}
      />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

/** Bouton principal vert (pilule) avec état de chargement. */
export function PrimaryButton({
  label,
  onPress,
  pending = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
}) {
  const inactive = pending || disabled;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: pending }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.primaryButton,
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}>
      {pending ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryLabel}>{label}</Text>}
    </Pressable>
  );
}

/** Bouton secondaire : contour gris sur fond noir. */
export function SecondaryButton({
  label,
  onPress,
  pending = false,
  disabled = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  pending?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  const inactive = pending || disabled;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: pending }}
      onPress={onPress}
      disabled={inactive}
      style={({ pressed }) => [
        styles.secondaryButton,
        pressed && styles.pressed,
        inactive && styles.disabled,
      ]}>
      {pending ? (
        <ActivityIndicator color="#fff" />
      ) : (
        <>
          {icon}
          <Text style={styles.secondaryLabel}>{label}</Text>
        </>
      )}
    </Pressable>
  );
}

/** Lien texte discret (changer de mode, renvoyer un code, se déconnecter…). */
export function TextLink({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      hitSlop={12}>
      <Text style={[styles.link, disabled && styles.disabled]}>{label}</Text>
    </Pressable>
  );
}

/** Bandeau d'erreur, `null` quand il n'y a rien à afficher. */
export function FormError({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <View accessibilityRole="alert" style={styles.errorBox}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  fieldWrapper: {
    alignSelf: 'stretch',
    gap: 6,
  },
  label: {
    color: '#b3b3b3',
    fontSize: 13,
    fontWeight: '700',
    marginLeft: 4,
  },
  input: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#3a3a3a',
    backgroundColor: '#121212',
    paddingHorizontal: 16,
    color: '#fff',
    fontSize: 16,
  },
  hint: {
    color: '#7a7a7a',
    fontSize: 12,
    marginLeft: 4,
  },
  primaryButton: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 999,
    backgroundColor: '#1ED760',
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryLabel: {
    color: '#000',
    fontSize: 16,
    fontWeight: '800',
  },
  secondaryButton: {
    alignSelf: 'stretch',
    height: 52,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#7a7a7a',
    backgroundColor: '#000',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  secondaryLabel: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  link: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
  errorBox: {
    alignSelf: 'stretch',
    borderRadius: 12,
    backgroundColor: 'rgba(255,79,79,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,79,79,0.45)',
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  errorText: {
    color: '#ff9b9b',
    fontSize: 14,
    lineHeight: 19,
  },
  pressed: {
    opacity: 0.75,
  },
  disabled: {
    opacity: 0.6,
  },
});
