import { DEFAULT_ESTIMATE_SPEED_KMH, type RouteResult } from '@/lib/routing';

/**
 * Simulation d'un trajet le long d'un itinéraire.
 *
 * Le principe : plutôt que de faire avancer un point à vitesse constante — ce
 * qui donne un véhicule qui traverse les carrefours en ligne droite sans
 * ralentir —, on **planifie le trajet une fois pour toutes** sous forme d'une
 * suite de positions horodatées. La lecture n'a plus alors qu'à interpoler
 * entre deux images selon le temps écoulé.
 *
 * Deux conséquences utiles :
 * — la physique (virages, arrêts) est écrite **une seule fois** ici, et non
 *   dupliquée entre la carte native, qui vit dans une WebView, et la carte web ;
 * — elle est calculable et vérifiable hors de tout rendu.
 *
 * Ce que le profil de vitesse prend en compte :
 * — **les virages** : la vitesse tombe à mesure que le cap change sur les
 *   quelques dizaines de mètres à venir, jusqu'au pas d'homme dans une épingle ;
 * — **les obstacles** : un changement de direction franc est traité comme un
 *   carrefour où l'on marque l'arrêt, d'autant plus long que l'angle est fermé.
 */

export type SimFrame = {
  /** Secondes depuis le départ. */
  t: number;
  lng: number;
  lat: number;
  /** Cap en degrés depuis le nord, pour orienter la caméra et le véhicule. */
  bearing: number;
  /**
   * Segment de `SimPlan.points` sur lequel se trouve cette image. C'est lui qui
   * permet d'effacer le tracé déjà parcouru : ce qui reste à faire, c'est la
   * position courante suivie des points d'indice strictement supérieur.
   */
  i: number;
};

export type SimPlan = {
  frames: SimFrame[];
  /**
   * Polyligne effectivement parcourue — l'itinéraire débarrassé de ses points
   * confondus. C'est elle que la carte doit tracer pendant la simulation, sinon
   * les indices des images ne désigneraient pas les bons sommets.
   */
  points: [number, number][];
  durationS: number;
  distanceM: number;
};

/** Pas d'échantillonnage : un point tous les 12 m, affiné par l'interpolation. */
const STEP_M = 12;

/** Nombre d'images au-delà duquel on allonge le pas plutôt que la liste. */
const MAX_FRAMES = 3000;

/** Distance sur laquelle on juge le virage qui arrive. */
const LOOKAHEAD_M = 40;

/** Vitesse plancher : le pas d'homme d'une épingle à cheveux. */
const MIN_SPEED_KMH = 7;

/** En deçà, le cap ne change pas assez pour lever le pied. */
const STRAIGHT_DEG = 12;

/** Au-delà, on est au minimum quoi qu'il arrive. */
const HAIRPIN_DEG = 90;

/** Part de la vitesse conservée dans un virage à angle droit. */
const HAIRPIN_FACTOR = 0.28;

/** Angle à partir duquel un sommet est traité comme un carrefour où l'on stoppe. */
const STOP_DEG = 70;

const MIN_STOP_S = 1.2;
const MAX_EXTRA_STOP_S = 1.8;

const R_EARTH_M = 6371000;
const toRad = (d: number) => (d * Math.PI) / 180;

function metersBetween(a: [number, number], b: [number, number]): number {
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearingBetween(a: [number, number], b: [number, number]): number {
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const dLng = toRad(b[0] - a[0]);
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Écart entre deux caps, ramené à l'intervalle [0, 180]. */
export function angleBetween(a: number, b: number): number {
  return Math.abs(((((a - b + 180) % 360) + 360) % 360) - 180);
}

/** Interpolation d'angle par le plus court chemin — 350° → 10° passe par 0. */
function lerpAngle(from: number, to: number, ratio: number): number {
  const delta = ((to - from + 540) % 360) - 180;
  return (from + delta * ratio + 360) % 360;
}

type Path = {
  points: [number, number][];
  /** Distance cumulée depuis le départ, un élément par point. */
  cumulative: number[];
  /** Cap du segment qui commence à ce point ; le dernier reprend le précédent. */
  bearings: number[];
  total: number;
};

/** Nettoie la polyligne et pré-calcule distances et caps. */
function buildPath(coords: [number, number][]): Path | null {
  const points: [number, number][] = [];
  for (const point of coords) {
    const previous = points[points.length - 1];
    // Deux points confondus ne portent aucun cap : ils fausseraient les virages.
    if (!previous || metersBetween(previous, point) > 0.5) points.push(point);
  }
  if (points.length < 2) return null;

  const cumulative = [0];
  const bearings: number[] = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    cumulative.push(cumulative[i] + metersBetween(points[i], points[i + 1]));
    bearings.push(bearingBetween(points[i], points[i + 1]));
  }
  bearings.push(bearings[bearings.length - 1]);

  return { points, cumulative, bearings, total: cumulative[cumulative.length - 1] };
}

/** Index du segment qui contient cette distance. */
function segmentAt(path: Path, distance: number): number {
  let low = 0;
  let high = path.cumulative.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (path.cumulative[mid] <= distance) low = mid;
    else high = mid;
  }
  return low;
}

/** Position, cap et segment courant à une distance donnée du départ. */
function locate(
  path: Path,
  distance: number,
): { lng: number; lat: number; bearing: number; i: number } {
  const clamped = Math.min(Math.max(distance, 0), path.total);
  const index = segmentAt(path, clamped);
  const from = path.points[index];
  const to = path.points[Math.min(index + 1, path.points.length - 1)];

  const span = path.cumulative[index + 1] - path.cumulative[index];
  const ratio = span > 0 ? (clamped - path.cumulative[index]) / span : 0;

  return {
    lng: from[0] + (to[0] - from[0]) * ratio,
    lat: from[1] + (to[1] - from[1]) * ratio,
    bearing: path.bearings[index],
    i: index,
  };
}

/**
 * Part de la vitesse conservée à cette distance, selon le virage qui vient.
 * `1` en ligne droite, `HAIRPIN_FACTOR` à angle droit et au-delà.
 */
function curveFactor(path: Path, distance: number): number {
  const here = path.bearings[segmentAt(path, distance)];
  const ahead = path.bearings[segmentAt(path, Math.min(distance + LOOKAHEAD_M, path.total))];
  const turn = angleBetween(here, ahead);

  if (turn <= STRAIGHT_DEG) return 1;
  if (turn >= HAIRPIN_DEG) return HAIRPIN_FACTOR;

  const ratio = (turn - STRAIGHT_DEG) / (HAIRPIN_DEG - STRAIGHT_DEG);
  return 1 - ratio * (1 - HAIRPIN_FACTOR);
}

/** Temps d'arrêt à un sommet, nul tant que le changement de cap reste doux. */
function stopSeconds(path: Path, index: number): number {
  if (index <= 0 || index >= path.bearings.length - 1) return 0;

  const turn = angleBetween(path.bearings[index - 1], path.bearings[index]);
  if (turn < STOP_DEG) return 0;

  const ratio = Math.min(1, (turn - STOP_DEG) / (180 - STOP_DEG));
  return MIN_STOP_S + ratio * MAX_EXTRA_STOP_S;
}

/**
 * Planifie le déplacement le long de `coords` à `speedKmh` de moyenne.
 *
 * La vitesse donnée est celle **en régime**, pas la moyenne constatée : le
 * trajet simulé dure donc plus longtemps que `distance / vitesse`, du temps
 * perdu dans les virages et aux carrefours. C'est voulu — c'est ce qui
 * distingue une simulation d'une simple interpolation linéaire.
 */
export function planSimulation(coords: [number, number][], speedKmh: number): SimPlan | null {
  const path = buildPath(coords);
  if (!path) return null;

  const cruise = speedKmh > 0 ? speedKmh : DEFAULT_ESTIMATE_SPEED_KMH;
  // Une longue course garde une liste raisonnable en espaçant les points.
  const step = Math.max(STEP_M, path.total / MAX_FRAMES);

  const frames: SimFrame[] = [];
  let distance = 0;
  let time = 0;
  let nextVertex = 1;

  const push = (d: number, t: number) => {
    const at = locate(path, d);
    frames.push({ t, lng: at.lng, lat: at.lat, bearing: at.bearing, i: at.i });
  };

  push(0, 0);

  while (distance < path.total) {
    const speedMs = Math.max(MIN_SPEED_KMH, cruise * curveFactor(path, distance)) / 3.6;
    const advance = Math.min(step, path.total - distance);

    distance += advance;
    time += advance / speedMs;

    /*
     * Sommets franchis pendant ce pas : chacun peut imposer un arrêt. Deux
     * images au même endroit encadrent l'immobilité, sinon l'interpolation la
     * lisserait en un simple ralentissement.
     */
    while (nextVertex < path.cumulative.length && path.cumulative[nextVertex] <= distance) {
      const hold = stopSeconds(path, nextVertex);
      if (hold > 0) {
        push(path.cumulative[nextVertex], time);
        time += hold;
        push(path.cumulative[nextVertex], time);
      }
      nextVertex += 1;
    }

    push(distance, time);
  }

  return { frames, points: path.points, durationS: time, distanceM: path.total };
}

export type SimSample = {
  lng: number;
  lat: number;
  bearing: number;
  /** Segment courant de `SimPlan.points`, pour effacer ce qui est derrière. */
  i: number;
  /** Avancement de 0 à 1, en temps et non en distance. */
  progress: number;
  remainingS: number;
  done: boolean;
};

/** Position simulée après `elapsedS` secondes de lecture. */
export function sampleSimulation(plan: SimPlan, elapsedS: number): SimSample {
  const { frames, durationS } = plan;
  const last = frames[frames.length - 1];

  if (elapsedS >= durationS) {
    return {
      lng: last.lng,
      lat: last.lat,
      bearing: last.bearing,
      i: last.i,
      progress: 1,
      remainingS: 0,
      done: true,
    };
  }

  let low = 0;
  let high = frames.length - 1;
  while (low < high - 1) {
    const mid = (low + high) >> 1;
    if (frames[mid].t <= elapsedS) low = mid;
    else high = mid;
  }

  const from = frames[low];
  const to = frames[low + 1] ?? from;
  const span = to.t - from.t;
  const ratio = span > 0 ? (elapsedS - from.t) / span : 0;

  return {
    lng: from.lng + (to.lng - from.lng) * ratio,
    lat: from.lat + (to.lat - from.lat) * ratio,
    bearing: lerpAngle(from.bearing, to.bearing, ratio),
    // Le segment de l'image de départ : on n'efface un sommet qu'une fois dépassé.
    i: from.i,
    progress: durationS > 0 ? elapsedS / durationS : 1,
    remainingS: Math.max(0, durationS - elapsedS),
    done: false,
  };
}

/**
 * Vitesse moyenne du véhicule sur cet itinéraire, telle que le service de
 * routage l'a estimée. C'est la meilleure valeur disponible : elle tient déjà
 * compte du type de voies empruntées, ce qu'une constante ne saurait faire.
 */
export function averageSpeedKmh(route: RouteResult | null): number {
  if (!route || route.durationS <= 0) return DEFAULT_ESTIMATE_SPEED_KMH;
  const kmh = route.distanceM / 1000 / (route.durationS / 3600);
  return Number.isFinite(kmh) && kmh > 1 ? kmh : DEFAULT_ESTIMATE_SPEED_KMH;
}
