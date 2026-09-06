/** Ce que l'on lit d'une `ClerkError` sans dépendre de sa classe interne. */
type ClerkLikeError = { code?: string; message?: string; longMessage?: string };

/**
 * Messages FR pour les codes d'erreur Clerk rencontrés dans les flux e-mail.
 * Les `longMessage` de Clerk sont en anglais : on traduit ce qui est fréquent
 * et on retombe sur le message brut pour le reste.
 */
const CLERK_MESSAGES: Record<string, string> = {
  form_identifier_not_found: "Aucun compte n'existe avec cette adresse e-mail.",
  form_password_incorrect: 'Mot de passe incorrect.',
  form_identifier_exists: 'Un compte existe déjà avec cette adresse e-mail.',
  form_param_format_invalid: "Le format de l'adresse e-mail est invalide.",
  form_param_nil: 'Tous les champs sont obligatoires.',
  form_password_length_too_short: 'Le mot de passe doit faire au moins 8 caractères.',
  form_password_pwned:
    'Ce mot de passe a déjà fuité dans une brèche de sécurité. Choisis-en un autre.',
  form_password_not_strong_enough: 'Mot de passe trop faible : ajoute des caractères variés.',
  form_code_incorrect: 'Code incorrect. Vérifie les 6 chiffres reçus par e-mail.',
  verification_failed: 'Vérification échouée. Demande un nouveau code.',
  verification_expired: 'Ce code a expiré. Demande un nouveau code.',
  too_many_requests: 'Trop de tentatives. Patiente une minute avant de réessayer.',
  session_exists: 'Une session est déjà active sur cet appareil.',
  captcha_invalid: "Vérification anti-robot échouée. Réessaie depuis l'application.",
};

const DEFAULT_MESSAGE = 'Une erreur est survenue. Réessaie dans un instant.';

/** Transforme une erreur Clerk (objet `{ error }` ou exception) en message FR. */
export function authErrorMessage(error: unknown, fallback = DEFAULT_MESSAGE): string {
  if (!error || typeof error !== 'object') return fallback;

  const { code, message, longMessage } = error as ClerkLikeError;
  if (code && CLERK_MESSAGES[code]) return CLERK_MESSAGES[code];

  return longMessage || message || fallback;
}

/**
 * Extrait le message d'une erreur levée par une mutation Convex.
 * En production Convex masque les `throw new Error(...)` derrière « Server Error » :
 * on retombe alors sur `fallback`.
 */
export function convexErrorMessage(error: unknown, fallback = DEFAULT_MESSAGE): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const thrown = /Uncaught Error:\s*(.+)/.exec(raw)?.[1];
  const firstLine = thrown?.split('\n')[0].trim();

  return firstLine || fallback;
}
