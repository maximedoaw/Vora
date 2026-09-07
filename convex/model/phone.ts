/**
 * Numéros de téléphone camerounais.
 *
 * Vora ne sert que le Cameroun : l'indicatif est fixe, l'utilisateur ne saisit
 * que les 9 chiffres locaux, tous préfixés par 6 depuis la refonte du plan de
 * numérotation.
 *
 * Seuls les préfixes Orange et MTN sont acceptés : ce sont les deux seuls
 * portefeuilles que Vora sait créditer. Un numéro Nexttel (66x) ou Camtel est
 * un numéro valide dans l'absolu, mais inutilisable ici — autant le dire à la
 * saisie plutôt qu'au moment de payer.
 *
 * ⚠️ La portabilité existe : un préfixe indique l'attribution d'origine, pas
 * l'opérateur courant. On s'en sert pour guider, jamais pour router un paiement.
 */

export const PHONE_PREFIX = "+237";
export const PHONE_DIGITS = 9;

export type PhoneOperator = "mtn" | "orange";

/** MTN Cameroun : 67x, 68x et 650 à 654. */
export const MTN_PATTERN = /^6(?:7\d|8\d|5[0-4])\d{6}$/;
/** Orange Cameroun : 69x et 655 à 659. */
export const ORANGE_PATTERN = /^6(?:9\d|5[5-9])\d{6}$/;

/** Ne garde que les chiffres, indicatif éventuel retiré. */
export function phoneDigits(input: string): string {
  const digits = input.replace(/\D/g, "");
  return digits.startsWith("237") ? digits.slice(3) : digits;
}

/** Opérateur déduit du préfixe, ou `null` si le numéro n'est ni MTN ni Orange. */
export function phoneOperator(input: string): PhoneOperator | null {
  const digits = phoneDigits(input);
  if (MTN_PATTERN.test(digits)) return "mtn";
  if (ORANGE_PATTERN.test(digits)) return "orange";
  return null;
}

export function isValidPhone(input: string): boolean {
  return phoneOperator(input) !== null;
}

/** Message d'erreur précis : la longueur d'abord, l'opérateur ensuite. */
export function phoneError(input: string): string | null {
  const digits = phoneDigits(input);
  if (digits.length === 0) return "Ton numéro de téléphone est requis.";
  if (digits.length !== PHONE_DIGITS) {
    return `Le numéro doit compter ${PHONE_DIGITS} chiffres après ${PHONE_PREFIX}.`;
  }
  if (!isValidPhone(digits)) {
    return "Numéro non reconnu : seuls les numéros Orange (69x, 655-659) et MTN (67x, 68x, 650-654) sont acceptés.";
  }
  return null;
}

/** Forme canonique stockée en base : `+2376XXXXXXXX`. */
export function normalizePhone(input: string): string | null {
  const digits = phoneDigits(input);
  return isValidPhone(digits) ? `${PHONE_PREFIX}${digits}` : null;
}
