import type { VehicleType } from '@/lib/vehicles';

/**
 * Répartition du tarif d'un trajet partagé.
 *
 * L'idée : plusieurs personnes qui vont dans la même direction montent dans le
 * même véhicule, sans forcément descendre au même endroit. Diviser la note en
 * parts égales serait injuste — celui qui descend au bout de deux kilomètres
 * paierait autant que celui qui va au terminus.
 *
 * La règle retenue découpe donc l'itinéraire en **segments**, délimités par
 * chaque montée et chaque descente. Le coût d'un segment est celui du tarif
 * appliqué à sa longueur et à sa durée, et il est divisé entre les seules
 * personnes présentes à bord **sur ce segment**. La part de chacun est la somme
 * des segments qu'il occupe.
 *
 * Conséquences, qui sont exactement le comportement attendu :
 * — descendre tôt coûte moins cher que d'aller jusqu'à la destination la plus
 *   éloignée, sans être un simple prorata de distance ;
 * — la fin du trajet, souvent parcourue seul, reste payée plein tarif par celui
 *   qui la parcourt ;
 * — chaque passager qui monte fait baisser la part de tous les autres.
 *
 * Deux garde-fous : personne ne paie moins que la prise en charge minimale du
 * véhicule, et **personne ne paie plus que son trajet seul** — partager ne peut
 * jamais coûter plus cher que ne pas partager.
 */

/** Identifiant conventionnel du passager principal, celui qui porte la course. */
export const MAIN_RIDER_ID = 'main';

/**
 * Miroir de `SEED_DELAY_MS` dans `convex/sharing.ts`.
 *
 * Repris ici plutôt qu'importé : le module serveur tire `_generated/server`,
 * qui n'a rien à faire dans le bundle de l'application. Seul l'affichage du
 * compte à rebours s'en sert — le délai qui fait foi reste celui du serveur, et
 * les deux valeurs doivent évoluer ensemble.
 */
export const SHARE_SEARCH_DELAY_MS = 2 * 60 * 1000;

/**
 * Occupation d'une portion d'itinéraire, en progression de 0 (point de prise en
 * charge) à 1 (destination du passager principal).
 */
export type SharedLeg = {
  id: string;
  name: string;
  from: number;
  to: number;
};

export type FareSplit = {
  id: string;
  name: string;
  /** Distance réellement parcourue par cette personne. */
  km: number;
  minutes: number;
  /** Part à régler, arrondie comme tous les tarifs de l'application. */
  amount: number;
  /** Ce que le même trajet coûterait sans partage. */
  soloAmount: number;
  saved: number;
  /** Économie en proportion, de 0 à 1. */
  savedRatio: number;
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const roundFare = (amount: number) => Math.ceil(amount / 25) * 25;

/** Les bornes de segment sont comparées à 10 m près, pas au bit près. */
const EPSILON = 1e-4;

/**
 * Coût brut d'une portion, prise en charge minimale exclue : celle-ci ne
 * s'applique qu'une fois, à la part finale de chaque personne.
 */
function legCost(type: VehicleType, km: number, minutes: number): number {
  return type.tariff.perKm * km + type.tariff.perMin * minutes;
}

/**
 * Parts de chacun sur un itinéraire de `distanceKm` / `durationMin`.
 *
 * `legs` décrit qui occupe quoi ; le passager principal y figure comme les
 * autres, avec `from: 0` et `to: 1`.
 */
export function splitSharedFare(
  type: VehicleType,
  distanceKm: number,
  durationMin: number,
  legs: SharedLeg[],
): FareSplit[] {
  const usable = legs
    .map((leg) => ({ ...leg, from: clamp01(leg.from), to: clamp01(leg.to) }))
    .filter((leg) => leg.to - leg.from > EPSILON);

  if (usable.length === 0) return [];

  // Chaque montée et chaque descente ouvre un nouveau segment.
  const bounds = Array.from(
    new Set([0, 1, ...usable.flatMap((leg) => [leg.from, leg.to])]),
  ).sort((a, b) => a - b);

  const raw = new Map<string, number>(usable.map((leg) => [leg.id, 0]));

  for (let i = 0; i < bounds.length - 1; i += 1) {
    const start = bounds[i];
    const end = bounds[i + 1];
    const span = end - start;
    if (span <= EPSILON) continue;

    const aboard = usable.filter((leg) => leg.from <= start + EPSILON && leg.to >= end - EPSILON);
    if (aboard.length === 0) continue;

    const cost = legCost(type, span * distanceKm, span * durationMin);
    const perHead = cost / aboard.length;
    for (const leg of aboard) {
      raw.set(leg.id, (raw.get(leg.id) ?? 0) + perHead);
    }
  }

  return usable.map((leg) => {
    const span = leg.to - leg.from;
    const km = span * distanceKm;
    const minutes = span * durationMin;

    // Tarif du même trajet, seul : c'est le plafond de la part partagée.
    const soloAmount = Math.max(type.tariff.minFare, roundFare(legCost(type, km, minutes)));
    const shared = Math.max(type.tariff.minFare, roundFare(raw.get(leg.id) ?? 0));
    const amount = Math.min(soloAmount, shared);

    return {
      id: leg.id,
      name: leg.name,
      km,
      minutes,
      amount,
      soloAmount,
      saved: soloAmount - amount,
      savedRatio: soloAmount > 0 ? (soloAmount - amount) / soloAmount : 0,
    };
  });
}

/** Part d'une personne donnée, `null` si elle n'occupe aucune portion. */
export function shareOf(splits: FareSplit[], id: string): FareSplit | null {
  return splits.find((split) => split.id === id) ?? null;
}

/** "−38 %" — vide tant que l'économie est négligeable. */
export function formatSaving(ratio: number): string | null {
  const percent = Math.round(ratio * 100);
  return percent >= 1 ? `−${percent} %` : null;
}
