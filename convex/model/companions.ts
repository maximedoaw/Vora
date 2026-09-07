/**
 * Passagers de test du trajet partagé.
 *
 * Pendant du fichier `src/lib/demo-drivers.ts` côté application : tant qu'aucun
 * autre passager réel ne circule sur le même axe, ces profils permettent de
 * voir le partage fonctionner de bout en bout — répartition du tarif comprise.
 *
 * Ils sont créés **côté serveur** et non simulés à l'écran : le chauffeur et le
 * passager doivent voir exactement les mêmes personnes, et l'attente de deux
 * minutes doit tenir même si l'application passe en arrière-plan.
 */

import { clamp01, interpolate, offsetAcross, type Point } from "./geo";

/** Préfixe de convention, comme `demo-driver-` côté chauffeurs. */
export const DEMO_COMPANION_PREFIX = "Passager test";

const NAMES = [
  "Ngassa Diane",
  "Bekolo Armand",
  "Etoundi Clarisse",
  "Mvondo Patrick",
  "Ateba Nadège",
  "Kamdem Yves",
  "Manga Sylvie",
  "Onana Cédric",
] as const;

/** Deux passagers montent rarement au même carrefour. */
const LATERAL_OFFSET_M = 35;

/** Un passager qui monterait à 5 m de la destination n'a aucun intérêt. */
const MIN_LEG = 0.18;

export type CompanionPlacement = {
  name: string;
  boardProgress: number;
  dropProgress: number;
  boardPoint: Point;
  dropPoint: Point;
};

function pickNames(count: number, taken: Set<string>): string[] {
  const pool = NAMES.filter((name) => !taken.has(name));
  const chosen: string[] = [];
  // Tirage sans remise ; si le vivier est épuisé on recycle avec un suffixe.
  for (let i = 0; i < count; i += 1) {
    if (pool.length === 0) {
      chosen.push(`${NAMES[i % NAMES.length]} ${i + 2}`);
      continue;
    }
    chosen.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  }
  return chosen;
}

function between(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * Place `count` passagers sur le segment `[after, 1]` de l'itinéraire.
 *
 * `after` est la progression déjà parcourue : au premier remplissage elle vaut
 * 0, et lors d'un remplacement de place elle vaut le point où le passager
 * précédent est descendu — le nouveau monte forcément devant le véhicule, pas
 * derrière lui.
 */
export function placeCompanions(
  pickup: Point,
  destination: Point,
  count: number,
  after: number,
  taken: Set<string>,
): CompanionPlacement[] {
  const start = clamp01(after);
  // Plus assez de trajet restant pour que le partage ait un sens.
  if (start > 1 - MIN_LEG) return [];

  const names = pickNames(count, taken);
  const window = 1 - start;

  return names.map((name, index) => {
    // Une tranche de fenêtre par passager : ils s'échelonnent au lieu de monter
    // tous au même endroit.
    const slot = window / (count * 2);
    const boardProgress = Math.min(
      1 - MIN_LEG,
      clamp01(start + slot * index + between(0.05, 0.9) * slot),
    );
    const dropProgress = clamp01(boardProgress + between(MIN_LEG, 1 - boardProgress));

    const rawBoard = interpolate(pickup, destination, boardProgress);
    const rawDrop = interpolate(pickup, destination, dropProgress);
    const side = index % 2 === 0 ? 1 : -1;

    return {
      name,
      boardProgress,
      dropProgress,
      boardPoint: offsetAcross(rawBoard, pickup, destination, side * LATERAL_OFFSET_M),
      dropPoint: offsetAcross(rawDrop, pickup, destination, side * LATERAL_OFFSET_M),
    };
  });
}
