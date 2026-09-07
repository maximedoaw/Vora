import { Image } from 'expo-image';
import { Check, ShieldCheck } from 'lucide-react-native';
import { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { VoraPalette } from '@/constants/theme';
import { useAppTheme } from '@/hooks/use-app-theme';
import { formatPhone } from '@/lib/phone';
import { formatXaf } from '@/lib/vehicles';

export type PaymentMethod = 'orange_money' | 'mtn_momo';

const METHODS: { value: PaymentMethod; label: string; logo: number }[] = [
  {
    value: 'orange_money',
    label: 'Orange Money',
    logo: require('../../assets/images/orange.png'),
  },
  {
    value: 'mtn_momo',
    label: 'MTN Mobile Money',
    logo: require('../../assets/images/mtn.png'),
  },
];

const MIN_CODE = 4;
const MAX_CODE = 6;

type Props = {
  amount: number;
  driverPhone: string | null;
  driverName: string;
  paid: { method: PaymentMethod; amount: number; toPhone: string | null } | null;
  busy: boolean;
  onPay: (method: PaymentMethod) => void;
};

function methodLabel(method: PaymentMethod) {
  return METHODS.find((entry) => entry.value === method)?.label ?? 'Mobile Money';
}

/**
 * Règlement de la course par le passager, avant qu'il n'y mette fin.
 *
 * ⚠️ Le transfert est **simulé** : aucun opérateur n'est branché. Le code saisi
 * n'est ni vérifié ni transmis — il est jeté à la fermeture de la boîte de
 * dialogue. Seuls le moyen, le montant et le numéro crédité sont enregistrés.
 */
export function RidePayment({ amount, driverPhone, driverName, paid, busy, onPay }: Props) {
  const { colors } = useAppTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [code, setCode] = useState('');
  const [asking, setAsking] = useState(false);

  if (paid) {
    return (
      <View style={styles.paidBox}>
        <ShieldCheck size={18} color={colors.accent} />
        <Text style={styles.paidText}>
          {`${formatXaf(paid.amount)} réglés via ${methodLabel(paid.method)}`}
          {paid.toPhone ? ` au ${formatPhone(paid.toPhone)}` : ''}
        </Text>
      </View>
    );
  }

  const codeValid = code.length >= MIN_CODE && code.length <= MAX_CODE;

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Régler la course</Text>
      <Text style={styles.amount}>{formatXaf(amount)}</Text>
      <Text style={styles.target}>
        {`À transférer à ${driverName} · ${formatPhone(driverPhone)}`}
      </Text>

      <View style={styles.methods}>
        {METHODS.map((entry) => {
          const selected = method === entry.value;
          return (
            <Pressable
              key={entry.value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              disabled={busy}
              onPress={() => setMethod(entry.value)}
              style={({ pressed }) => [
                styles.method,
                selected && styles.methodSelected,
                pressed && styles.pressed,
              ]}>
              <Image source={entry.logo} style={styles.logo} contentFit="contain" />
              <Text style={[styles.methodLabel, selected && styles.methodLabelSelected]}>
                {entry.label}
              </Text>
              {selected ? <Check size={14} color={colors.accent} /> : null}
            </Pressable>
          );
        })}
      </View>

      <Pressable
        accessibilityRole="button"
        disabled={!method || busy}
        onPress={() => {
          setCode('');
          setAsking(true);
        }}
        style={({ pressed }) => [
          styles.payButton,
          (!method || busy) && styles.payButtonDisabled,
          pressed && styles.pressed,
        ]}>
        {busy ? (
          <ActivityIndicator color={colors.onAccent} size="small" />
        ) : (
          <Text style={[styles.payLabel, !method && styles.payLabelDisabled]}>
            {method ? `Payer ${formatXaf(amount)}` : 'Choisis un moyen de paiement'}
          </Text>
        )}
      </Pressable>

      <Text style={styles.disclaimer}>
        Transfert simulé : aucun opérateur n&apos;est encore connecté à Vora.
      </Text>

      {/* `Alert.prompt` n'existe que sur iOS : la boîte de saisie est refaite ici
          pour se comporter pareil sur Android. */}
      <Modal
        visible={asking}
        transparent
        animationType="fade"
        onRequestClose={() => setAsking(false)}>
        <View style={styles.backdrop}>
          <View style={styles.dialog}>
            <Text style={styles.dialogTitle}>{method ? methodLabel(method) : 'Paiement'}</Text>
            <Text style={styles.dialogText}>
              {`Saisis le code secret de ton compte pour transférer ${formatXaf(amount)} au ${formatPhone(driverPhone)}.`}
            </Text>

            <TextInput
              value={code}
              onChangeText={(text) => setCode(text.replace(/\D/g, '').slice(0, MAX_CODE))}
              placeholder="Code secret"
              placeholderTextColor={colors.placeholder}
              keyboardType="number-pad"
              secureTextEntry
              autoFocus
              style={styles.codeInput}
            />

            <View style={styles.dialogActions}>
              <Pressable
                accessibilityRole="button"
                onPress={() => setAsking(false)}
                style={({ pressed }) => [styles.dialogButton, pressed && styles.pressed]}>
                <Text style={styles.dialogCancel}>Annuler</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                disabled={!codeValid}
                onPress={() => {
                  setAsking(false);
                  // Le code ne quitte jamais cet écran : il sert de confirmation.
                  setCode('');
                  if (method) onPay(method);
                }}
                style={({ pressed }) => [styles.dialogButton, pressed && styles.pressed]}>
                <Text style={[styles.dialogConfirm, !codeValid && styles.dialogDisabled]}>
                  Valider
                </Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const createStyles = (c: VoraPalette) =>
  StyleSheet.create({
    root: {
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
      paddingTop: 14,
    },
    title: {
      color: c.textMuted,
      fontSize: 11,
      fontWeight: '800',
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    amount: {
      color: c.text,
      fontSize: 24,
      fontWeight: '800',
    },
    target: {
      color: c.textSecondary,
      fontSize: 12,
    },
    methods: {
      gap: 8,
      marginTop: 4,
    },
    method: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      height: 58,
      borderRadius: 14,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      paddingHorizontal: 12,
    },
    methodSelected: {
      borderColor: c.accentBorder,
      backgroundColor: c.accentSoft,
    },
    logo: {
      width: 56,
      height: 36,
      borderRadius: 6,
    },
    methodLabel: {
      flex: 1,
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '700',
    },
    methodLabelSelected: {
      color: c.text,
    },
    payButton: {
      alignItems: 'center',
      justifyContent: 'center',
      height: 46,
      borderRadius: 14,
      backgroundColor: c.accent,
      marginTop: 4,
    },
    payButtonDisabled: {
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
    },
    payLabel: {
      color: c.onAccent,
      fontSize: 15,
      fontWeight: '800',
    },
    payLabelDisabled: {
      color: c.textMuted,
    },
    disclaimer: {
      color: c.textMuted,
      fontSize: 11,
      lineHeight: 15,
    },
    paidBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: c.divider,
      paddingTop: 14,
    },
    paidText: {
      flex: 1,
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      paddingHorizontal: 32,
    },
    dialog: {
      alignSelf: 'stretch',
      backgroundColor: c.surfaceAlt,
      borderRadius: 18,
      borderWidth: 1,
      borderColor: c.border,
      paddingHorizontal: 20,
      paddingVertical: 18,
      gap: 10,
    },
    dialogTitle: {
      color: c.text,
      fontSize: 17,
      fontWeight: '800',
    },
    dialogText: {
      color: c.textSecondary,
      fontSize: 13,
      lineHeight: 18,
    },
    codeInput: {
      height: 48,
      borderRadius: 12,
      borderWidth: 1,
      borderColor: c.border,
      backgroundColor: c.surfaceMuted,
      paddingHorizontal: 14,
      color: c.text,
      fontSize: 18,
      letterSpacing: 6,
      marginTop: 4,
    },
    dialogActions: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      gap: 8,
      marginTop: 4,
    },
    dialogButton: {
      paddingHorizontal: 14,
      paddingVertical: 8,
    },
    dialogCancel: {
      color: c.textSecondary,
      fontSize: 14,
      fontWeight: '700',
    },
    dialogConfirm: {
      color: c.accent,
      fontSize: 14,
      fontWeight: '800',
    },
    dialogDisabled: {
      color: c.textMuted,
    },
    pressed: {
      opacity: 0.75,
    },
  });
