import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { currentUser } from "./model/auth";
import { placeCompanions } from "./model/companions";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Trajet partagé.
 *
 * Le passager ouvre sa course : d'autres personnes qui vont **dans la même
 * direction** montent en chemin, sans forcément aller au même endroit. Chacun
 * ne paie que les portions du trajet qu'il occupe, divisées par le nombre de
 * personnes à bord sur ces portions — la répartition elle-même est calculée
 * côté application (`src/lib/shared-ride.ts`), là où vit la grille tarifaire.
 *
 * Ce module ne connaît donc aucun prix : il tient qui monte, où, et jusqu'où.
 */

/**
 * Délai avant l'arrivée des passagers de test.
 *
 * Deux minutes : le temps qu'un vrai jumelage prendrait, et assez pour que
 * l'écran d'attente soit visible sans être pénible. C'est un `scheduler` Convex
 * et non un `setTimeout` côté app — l'attente survit à la mise en arrière-plan.
 */
export const SEED_DELAY_MS = 2 * 60 * 1000;

/** Nombre de passagers de test ajoutés à la première recherche. */
const SEED_COUNT = 2;

/** Véhicule inconnu (course pas encore acceptée) : hypothèse berline. */
const DEFAULT_SEATS = 4;

const ACTIVE_RIDE_STATUSES = ["requested", "matched", "in_progress"] as const;

export type CompanionStatus = "waiting" | "onboard" | "dropped" | "cancelled";

export type RideCompanion = {
  id: Id<"rideCompanions">;
  name: string;
  /** `true` = profil de test, signalé comme tel dans l'application. */
  demo: boolean;
  /** Progression sur l'itinéraire du passager principal, de 0 à 1. */
  boardProgress: number;
  dropProgress: number;
  boardPoint: { lat: number; lng: number };
  dropPoint: { lat: number; lng: number };
  status: CompanionStatus;
  joinedAt: number;
};

export type SharingState = {
  enabled: boolean;
  sharedAt: number | null;
  seats: number;
  /** Places encore libres, le passager principal déduit. */
  freeSeats: number;
  companions: RideCompanion[];
};

function isActive(ride: Doc<"rides">) {
  return (ACTIVE_RIDE_STATUSES as readonly string[]).includes(ride.status);
}

/** Une place occupée l'est tant que le passager n'est pas descendu ou parti. */
function occupies(companion: Doc<"rideCompanions">) {
  return companion.status === "waiting" || companion.status === "onboard";
}

/**
 * Course visible par l'utilisateur connecté — passager, chauffeur attribué, ou
 * chauffeur sollicité sur une demande encore ouverte. Même règle que
 * `rides.participantIn`, redite ici pour ne pas exporter d'interne depuis
 * `rides.ts`.
 */
async function accessRide(ctx: QueryCtx, rideId: Id<"rides">) {
  const me = await currentUser(ctx);
  if (!me) return null;
  const ride = await ctx.db.get(rideId);
  if (!ride) return null;

  const asRider = ride.riderId === me._id;
  let asDriver = ride.driverId === me._id;

  if (!asRider && !asDriver && ride.status === "requested" && ride.conversationId) {
    const conversation = await ctx.db.get(ride.conversationId);
    asDriver = conversation?.driverKey === me._id;
  }

  if (!asRider && !asDriver) return null;
  return { me, ride, asRider, asDriver };
}

async function companionsOf(ctx: QueryCtx, rideId: Id<"rides">) {
  return ctx.db
    .query("rideCompanions")
    .withIndex("by_ride", (q) => q.eq("rideId", rideId))
    .collect();
}

function toCompanion(row: Doc<"rideCompanions">): RideCompanion {
  return {
    id: row._id,
    name: row.name,
    demo: row.demo,
    boardProgress: row.boardProgress,
    dropProgress: row.dropProgress,
    boardPoint: row.boardPoint,
    dropPoint: row.dropPoint,
    status: row.status,
    joinedAt: row.joinedAt,
  };
}

/**
 * Ajoute des passagers sur la portion d'itinéraire qui reste à parcourir.
 *
 * Appelée deux fois dans la vie d'une course : à l'expiration du délai de
 * recherche, puis à chaque descente — c'est le remplissage immédiat de la place
 * libérée, le cœur de l'idée.
 */
async function seed(ctx: MutationCtx, rideId: Id<"rides">, count: number, after: number) {
  const ride = await ctx.db.get(rideId);
  if (!ride || !ride.shared || !isActive(ride) || !ride.destination) return 0;

  const rows = await companionsOf(ctx, rideId);
  // Le passager principal occupe déjà une place.
  const seats = ride.seats ?? DEFAULT_SEATS;
  const free = seats - 1 - rows.filter(occupies).length;
  const wanted = Math.min(count, free);
  if (wanted <= 0) return 0;

  const taken = new Set(rows.map((row) => row.name));
  const placements = placeCompanions(ride.pickup, ride.destination, wanted, after, taken);
  if (placements.length === 0) return 0;

  const now = Date.now();
  for (const placement of placements) {
    await ctx.db.insert("rideCompanions", {
      rideId,
      name: placement.name,
      demo: true,
      boardProgress: placement.boardProgress,
      dropProgress: placement.dropProgress,
      boardPoint: placement.boardPoint,
      dropPoint: placement.dropPoint,
      status: "waiting",
      joinedAt: now,
    });
  }

  const label =
    placements.length === 1
      ? `${placements[0].name} rejoint le trajet.`
      : `${placements.length} passagers rejoignent le trajet.`;

  await ctx.scheduler.runAfter(0, internal.push.send, {
    userId: ride.riderId,
    title: "Trajet partagé",
    body: `${label} Ta part du tarif baisse.`,
    url: `/ride/${rideId}`,
  });

  if (ride.driverId) {
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: ride.driverId,
      title: "Passagers à récupérer",
      body: `${label} Ils montent sur ton itinéraire.`,
      url: `/ride/${rideId}`,
    });
  }

  return placements.length;
}

/**
 * Le passager ouvre — ou referme — sa course au partage.
 *
 * `seats` vient de l'application : c'est elle qui tient la grille des types de
 * véhicule. Absent, on suppose une berline.
 */
export const setShared = mutation({
  args: {
    rideId: v.id("rides"),
    enabled: v.boolean(),
    seats: v.optional(v.number()),
  },
  handler: async (ctx, { rideId, enabled, seats }) => {
    const found = await accessRide(ctx, rideId);
    if (!found) throw new Error("Course introuvable.");
    if (!found.asRider) throw new Error("Seul le passager décide de partager son trajet.");
    if (!isActive(found.ride)) throw new Error("Cette course est déjà close.");

    if (!enabled) {
      const rows = await companionsOf(ctx, rideId);
      if (rows.some((row) => row.status === "onboard")) {
        throw new Error("Un passager est déjà à bord : le trajet ne peut plus être refermé.");
      }
      // Ceux qui attendaient encore n'ont jamais été récupérés : on les libère.
      for (const row of rows.filter((r) => r.status === "waiting")) {
        await ctx.db.patch(row._id, { status: "cancelled" });
      }
      await ctx.db.patch(rideId, { shared: false });
      return false;
    }

    if (!found.ride.destination) {
      throw new Error("Choisis une destination : sans elle, aucun trajet à partager.");
    }
    if (found.ride.shared) return true;

    const capacity = seats && seats >= 2 ? Math.min(Math.round(seats), 8) : DEFAULT_SEATS;
    await ctx.db.patch(rideId, { shared: true, sharedAt: Date.now(), seats: capacity });

    // Deux minutes de recherche avant que quiconque n'apparaisse.
    await ctx.scheduler.runAfter(SEED_DELAY_MS, internal.sharing.searchCompanions, { rideId });
    return true;
  },
});

/** Fin du délai de recherche : les premiers passagers sont proposés. */
export const searchCompanions = internalMutation({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => seed(ctx, rideId, SEED_COUNT, 0),
});

/** Place libérée par une descente : elle est reprise sur-le-champ. */
export const refillSeat = internalMutation({
  args: { rideId: v.id("rides"), after: v.number() },
  handler: async (ctx, { rideId, after }) => seed(ctx, rideId, 1, after),
});

/**
 * Montée d'un passager partagé.
 *
 * Ouverte aux deux parties, comme la clôture de course : sur le terrain, celui
 * qui constate la montée en premier la valide, sans attendre l'autre.
 */
export const board = mutation({
  args: { companionId: v.id("rideCompanions") },
  handler: async (ctx, { companionId }) => {
    const companion = await ctx.db.get(companionId);
    if (!companion) throw new Error("Passager introuvable.");

    const found = await accessRide(ctx, companion.rideId);
    if (!found) throw new Error("Course introuvable.");
    if (!isActive(found.ride)) throw new Error("Cette course est déjà close.");
    if (companion.status !== "waiting") throw new Error("Ce passager est déjà monté.");

    await ctx.db.patch(companionId, { status: "onboard", boardedAt: Date.now() });
  },
});

/**
 * Descente d'un passager partagé — et remplissage immédiat de sa place.
 *
 * Le remplacement est programmé plutôt qu'exécuté ici : la descente ne doit pas
 * échouer parce qu'aucun passager n'a pu être trouvé pour la remplacer.
 */
export const drop = mutation({
  args: { companionId: v.id("rideCompanions") },
  handler: async (ctx, { companionId }) => {
    const companion = await ctx.db.get(companionId);
    if (!companion) throw new Error("Passager introuvable.");

    const found = await accessRide(ctx, companion.rideId);
    if (!found) throw new Error("Course introuvable.");
    if (companion.status !== "onboard") throw new Error("Ce passager n'est pas à bord.");

    await ctx.db.patch(companionId, { status: "dropped", droppedAt: Date.now() });

    if (found.ride.shared && isActive(found.ride)) {
      await ctx.scheduler.runAfter(0, internal.sharing.refillSeat, {
        rideId: companion.rideId,
        after: companion.dropProgress,
      });
    }
  },
});

/** État du partage pour une course, vu par l'un de ses participants. */
export const stateOf = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }): Promise<SharingState | null> => {
    const found = await accessRide(ctx, rideId);
    if (!found) return null;

    const rows = await companionsOf(ctx, rideId);
    const seats = found.ride.seats ?? DEFAULT_SEATS;
    const busy = rows.filter(occupies).length;

    /*
     * `sharedAt` est renvoyé brut, sans en déduire ici un état « recherche en
     * cours » : une requête Convex ne se relance qu'au changement des données,
     * jamais au passage du temps — l'écran resterait sur son indicateur une
     * fois le délai écoulé si personne ne montait. C'est donc l'application qui
     * compare cet horodatage à l'heure courante.
     */
    return {
      enabled: found.ride.shared === true,
      sharedAt: found.ride.sharedAt ?? null,
      seats,
      freeSeats: Math.max(0, seats - 1 - busy),
      companions: rows
        .filter((row) => row.status !== "cancelled")
        .map(toCompanion)
        .sort((a, b) => a.boardProgress - b.boardProgress),
    };
  },
});
