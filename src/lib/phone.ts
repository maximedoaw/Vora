/**
 * Numéros camerounais côté app — miroir de `convex/model/phone.ts`.
 *
 * La validation est dupliquée volontairement : le serveur reste la référence,
 * mais l'utilisateur doit voir son erreur en tapant, sans aller-retour réseau.
 * Les deux fichiers doivent évoluer ensemble.
 */

export const PHONE_PREFIX = '+237';
export const PHONE_DIGITS = 9;

export type PhoneOperator = 'mtn' | 'orange';

/** MTN Cameroun : 67x, 68x et 650 à 654. */
export const MTN_PATTERN = /^6(?:7\d|8\d|5[0-4])\d{6}$/;
/** Orange Cameroun : 69x et 655 à 659. */
export const ORANGE_PATTERN = /^6(?:9\d|5[5-9])\d{6}$/;

export const OPERATOR_LABEL: Record<PhoneOperator, string> = {
  mtn: 'MTN Mobile Money',
  orange: 'Orange Money',
};

export function phoneDigits(input: string): string {
  const digits = input.replace(/\D/g, '');
  return digits.startsWith('237') ? digits.slice(3) : digits;
}

/** Opérateur déduit du préfixe, ou `null` si le numéro n'est ni MTN ni Orange. */
export function phoneOperator(input: string): PhoneOperator | null {
  const digits = phoneDigits(input);
  if (MTN_PATTERN.test(digits)) return 'mtn';
  if (ORANGE_PATTERN.test(digits)) return 'orange';
  return null;
}

export function isValidPhone(input: string): boolean {
  return phoneOperator(input) !== null;
}

/** Message d'erreur précis : la longueur d'abord, l'opérateur ensuite. */
export function phoneError(input: string): string | null {
  const digits = phoneDigits(input);
  if (digits.length === 0) return 'Ton numéro de téléphone est requis.';
  if (digits.length !== PHONE_DIGITS) {
    return `Le numéro doit compter ${PHONE_DIGITS} chiffres après ${PHONE_PREFIX}.`;
  }
  if (!isValidPhone(digits)) {
    return 'Numéro non reconnu : seuls les numéros Orange (69x, 655-659) et MTN (67x, 68x, 650-654) sont acceptés.';
  }
  return null;
}

/** `+237 6 12 34 56 78` — lisible et vérifiable d'un coup d'œil. */
export function formatPhone(input: string | null | undefined): string {
  if (!input) return 'Numéro inconnu';
  const digits = phoneDigits(input);
  if (digits.length !== PHONE_DIGITS) return input;
  const groups = [digits.slice(0, 1), digits.slice(1, 3), digits.slice(3, 5), digits.slice(5, 7), digits.slice(7)];
  return `${PHONE_PREFIX} ${groups.join(' ')}`;
}
