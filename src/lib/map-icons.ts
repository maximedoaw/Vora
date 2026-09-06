/**
 * Icônes SVG pour les marqueurs de carte.
 *
 * Les marqueurs MapLibre sont des éléments DOM : ils vivent dans la WebView
 * (natif) ou dans la page (web), hors de React. `lucide-react-native` ne peut
 * donc pas y être rendu — la géométrie de son icône `car-front` est reprise ici
 * telle quelle (lucide, licence ISC) et sérialisée en balisage SVG.
 */

const CAR_FRONT_PATHS = [
  'm21 8-2 2-1.5-3.7A2 2 0 0 0 15.646 5H8.4a2 2 0 0 0-1.903 1.257L5 10 3 8',
  'M7 14h.01',
  'M17 14h.01',
  'M5 18v2',
  'M19 18v2',
] as const;

const CAR_FRONT_RECT = '<rect width="18" height="8" x="3" y="10" rx="2" />';

/**
 * Balisage SVG de l'icône voiture, prêt à être inséré dans un marqueur.
 * `color` est appliqué au trait ; le SVG n'a pas de remplissage.
 */
export function carIconSvg(color: string, size = 16): string {
  const paths = CAR_FRONT_PATHS.map((d) => `<path d="${d}" />`).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" ` +
    `stroke-linecap="round" stroke-linejoin="round">${paths}${CAR_FRONT_RECT}</svg>`
  );
}
