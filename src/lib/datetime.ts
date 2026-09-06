/** Formatage de dates léger — pas d'Intl, comportement identique sur tous les moteurs. */

const pad = (n: number) => String(n).padStart(2, '0');

/** `14:07` */
export function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** `06/09/2026` */
export function formatDate(timestamp: number): string {
  const d = new Date(timestamp);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function isSameDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

/** Séparateur de jour dans un fil : `Aujourd'hui`, `Hier`, sinon la date. */
export function formatDayLabel(timestamp: number): string {
  const now = Date.now();
  if (isSameDay(timestamp, now)) return "Aujourd'hui";
  if (isSameDay(timestamp, now - 24 * 3600 * 1000)) return 'Hier';
  return formatDate(timestamp);
}

/** Horodatage court d'une liste de discussions : heure aujourd'hui, sinon le jour. */
export function formatStamp(timestamp: number): string {
  return isSameDay(timestamp, Date.now()) ? formatTime(timestamp) : formatDayLabel(timestamp);
}
