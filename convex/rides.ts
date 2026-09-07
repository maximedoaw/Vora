import { v } from "convex/values";

import { internal } from "./_generated/api";
import { mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import { currentUser } from "./model/auth";
import { normalizePhone } from "./model/phone";
import type { Doc, Id } from "./_generated/dataModel";

export type RideStatus = "requested" | "matched" | "in_progress" | "completed" | "cancelled";

export type PaymentMethod = "orange_money" | "mtn_momo";

export type RidePayment = {
  method: PaymentMethod;
  amount: number;
  paidAt: number;
  toPhone: string | null;
};

/** Rayon de l'alerte « ton chauffeur arrive » — envoyée une seule fois. */
const NEAR_RADIUS_M = 200;

/**
 * Rayon de la **jonction** : en deçà, le chauffeur et son passager sont au même
 * endroit — donc ensemble dans le véhicule. La course démarre alors d'elle-même
 * et les deux téléphones se mettent à alimenter la même position suivie.
 *
 * Cinq mètres est plus fin que ce qu'un GPS de téléphone sait garantir (5 à
 * 20 m d'incertitude en ville). La jonction automatique est donc un
 * accélérateur, pas l'unique chemin : le bouton « Démarrer la course » reste en
 * place et produit exactement le même résultat.
 */
export const JOIN_RADIUS_M = 5;

/** Au-delà, la position enregistrée d'un compte est trop vieille pour servir. */
const FRESH_POSITION_MS = 3 * 60 * 1000;

const R_EARTH_KM = 6371;

function haversineKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return R_EARTH_KM * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

/** Statuts pendant lesquels la course occupe encore les deux parties. */
const ACTIVE_STATUSES: RideStatus[] = ["requested", "matched", "in_progress"];

export type RideSummary = {
  id: Id<"rides">;
  status: RideStatus;
  /** Nom de l'autre partie : le chauffeur côté passager, et inversement. */
  counterpart: string;
  /** `true` si l'utilisateur connecté est le chauffeur de cette course. */
  asDriver: boolean;
  pickup: { lat: number; lng: number };
  pickupName: string | null;
  /** Montant réglé, `null` tant que la course n'est pas payée. */
  paidAmount: number | null;
  destination: { lat: number; lng: number } | null;
  destinationName: string | null;
  /** Note donnée par le passager, `null` tant qu'il n'a pas évalué. */
  rating: number | null;
  conversationId: Id<"conversations"> | null;
  requestedAt: number;
  acceptedAt: number | null;
  /** Instant de la jonction à moins de 5 m, `null` si elle n'a pas eu lieu. */
  joinedAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  cancelledBy: "rider" | "driver" | null;
};

export type RideDetail = RideSummary & {
  riderName: string;
  driverName: string | null;
  vehicle: { type: string; plate: string } | null;
  /** `true` si le chauffeur consulté peut encore accepter ou refuser. */
  canRespond: boolean;
  /** Numéro à créditer, affiché au passager au moment de payer. */
  driverPhone: string | null;
  payment: RidePayment | null;
  /** Dernière position connue du chauffeur pour cette course. */
  driverPosition: { lat: number; lng: number; heading: number | null; at: number } | null;
};

/** `2 450 FCFA` — même rendu que la grille tarifaire côté app. */
function formatXaf(amount: number): string {
  return `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 }).format(amount)} FCFA`;
}

function isActive(status: RideStatus) {
  return ACTIVE_STATUSES.includes(status);
}

/**
 * La course demandée, si l'utilisateur connecté y a sa place.
 *
 * Sont concernés le passager, le chauffeur attribué, et — tant que la course
 * est seulement `requested` — le chauffeur à qui elle est adressée : il doit
 * pouvoir consulter le trajet avant de trancher, sans être déjà engagé.
 */
async function participantIn(ctx: QueryCtx, rideId: Id<"rides">) {
  const me = await currentUser(ctx);
  if (!me) return null;
  const ride = await ctx.db.get(rideId);
  if (!ride) return null;

  const asRider = ride.riderId === me._id;
  const asDriver = ride.driverId === me._id;

  let invited = false;
  if (!asRider && !asDriver && ride.status === "requested" && ride.conversationId) {
    const conversation = await ctx.db.get(ride.conversationId);
    invited = conversation?.driverKey === me._id;
  }

  if (!asRider && !asDriver && !invited) return null;

  return { me, ride, asDriver: asDriver || invited, invited };
}

async function nameOf(ctx: QueryCtx, userId: Id<"users"> | undefined, fallback: string) {
  if (!userId) return null;
  const user = await ctx.db.get(userId);
  return user?.name ?? fallback;
}

async function summarize(
  ctx: QueryCtx,
  ride: Doc<"rides">,
  meId: Id<"users">,
): Promise<RideSummary> {
  const asDriver = ride.driverId === meId;
  const counterpart = asDriver
    ? ((await nameOf(ctx, ride.riderId, "Passager")) ?? "Passager")
    : ((await nameOf(ctx, ride.driverId, "Chauffeur")) ?? "Chauffeur en attente");

  return {
    id: ride._id,
    status: ride.status,
    counterpart,
    asDriver,
    pickup: ride.pickup,
    pickupName: ride.pickupName ?? null,
    paidAmount: ride.paidAt ? (ride.paymentAmount ?? 0) : null,
    destination: ride.destination ?? null,
    destinationName: ride.destinationName ?? null,
    rating: ride.rating ?? null,
    conversationId: ride.conversationId ?? null,
    requestedAt: ride._creationTime,
    acceptedAt: ride.acceptedAt ?? null,
    joinedAt: ride.joinedAt ?? null,
    startedAt: ride.startedAt ?? null,
    endedAt: ride.endedAt ?? null,
    cancelledBy: ride.cancelledBy ?? null,
  };
}

/** Position du chauffeur pour une course, écrasée en place à chaque envoi. */
async function positionRow(ctx: QueryCtx, rideId: Id<"rides">) {
  return ctx.db
    .query("driverPositions")
    .withIndex("by_ride", (q) => q.eq("rideId", rideId))
    .unique();
}

/**
 * Courses actives de l'utilisateur, qu'il les conduise ou qu'il y soit passager.
 *
 * Les deux rôles sont retenus parce que le suivi ne s'arrête plus au chauffeur :
 * une fois la jonction faite, le téléphone du passager avance au même rythme et
 * peut tout aussi bien rapporter la position du véhicule.
 */
export async function activeRidesOf(ctx: QueryCtx, userId: Id<"users">) {
  const [asDriver, asRider] = await Promise.all([
    ctx.db
      .query("rides")
      .withIndex("by_driver", (q) => q.eq("driverId", userId))
      .collect(),
    ctx.db
      .query("rides")
      .withIndex("by_rider", (q) => q.eq("riderId", userId))
      .collect(),
  ]);

  const seen = new Set<string>();
  return [...asDriver, ...asRider].filter((ride) => {
    if (!isActive(ride.status) || seen.has(ride._id)) return false;
    seen.add(ride._id);
    return true;
  });
}

/** Écrit — ou écrase — la position suivie d'une course. */
async function writePosition(
  ctx: MutationCtx,
  rideId: Id<"rides">,
  lat: number,
  lng: number,
  heading: number | undefined,
  source: "driver" | "rider",
) {
  const existing = await positionRow(ctx, rideId);
  const updatedAt = Date.now();

  if (existing) {
    await ctx.db.patch(existing._id, { lat, lng, heading, updatedAt, source });
    return;
  }
  await ctx.db.insert("driverPositions", { rideId, lat, lng, heading, updatedAt, source });
}

/**
 * Position du passager pour tester la jonction.
 *
 * Sa position vivante si elle est fraîche, sinon le point de prise en charge :
 * c'est là qu'il a dit attendre, et c'est mieux que de ne rien pouvoir conclure
 * quand son téléphone n'émet pas.
 */
function riderPointOf(ride: Doc<"rides">, rider: Doc<"users"> | null, now: number): [number, number] {
  const fresh =
    rider?.lastLng != null &&
    rider.lastLat != null &&
    now - (rider.lastPositionAt ?? 0) < FRESH_POSITION_MS;

  return fresh
    ? [rider.lastLng as number, rider.lastLat as number]
    : [ride.pickup.lng, ride.pickup.lat];
}

/**
 * Jonction du chauffeur et de son passager.
 *
 * Elle fait basculer la course en `in_progress` : à partir de là ils avancent
 * ensemble vers la destination, et plus rien ne les sépare jusqu'à ce que l'un
 * des deux annule ou déclare la course terminée.
 *
 * Le drapeau est posé dans la même transaction que le test — Convex sérialise
 * les mutations, deux positions arrivées coup sur coup ne peuvent pas franchir
 * le seuil toutes les deux.
 */
async function joinIfTogether(
  ctx: MutationCtx,
  ride: Doc<"rides">,
  driverPoint: [number, number],
  riderPoint: [number, number],
) {
  if (ride.status !== "matched" || ride.joinedAt) return false;
  if (haversineKm(driverPoint, riderPoint) * 1000 > JOIN_RADIUS_M) return false;

  const now = Date.now();
  await ctx.db.patch(ride._id, {
    status: "in_progress",
    joinedAt: now,
    startedAt: ride.startedAt ?? now,
  });

  const url = `/ride/${ride._id}`;
  await ctx.scheduler.runAfter(0, internal.push.send, {
    userId: ride.riderId,
    title: "En route",
    body: "Tu es à bord : la course a démarré vers ta destination.",
    url,
  });

  if (ride.driverId) {
    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: ride.driverId,
      title: "En route",
      body: "Ton passager est à bord : la course a démarré.",
      url,
    });
  }

  return true;
}

/**
 * Alimente le suivi de toutes les courses actives de cet utilisateur, et
 * indique s'il y en avait au moins une — ce qui commande le rythme
 * d'enregistrement de sa position dans `users`.
 *
 * Avant la jonction, seul le chauffeur écrit : la position du passager est
 * celle du point de rendez-vous, pas celle du véhicule. Après, les deux
 * écrivent — ils sont au même endroit et l'un des deux peut avoir mis
 * l'application en arrière-plan.
 */
export async function trackRide(
  ctx: MutationCtx,
  userId: Id<"users">,
  lat: number,
  lng: number,
  heading?: number,
): Promise<boolean> {
  const rides = await activeRidesOf(ctx, userId);
  if (rides.length === 0) return false;

  const now = Date.now();
  const point: [number, number] = [lng, lat];

  for (const ride of rides) {
    const asDriver = ride.driverId === userId;

    if (asDriver) {
      await writePosition(ctx, ride._id, lat, lng, heading, "driver");

      const rider = await ctx.db.get(ride.riderId);

      /**
       * « Ton chauffeur arrive » — une seule fois par course, et seulement en
       * `matched` : en `in_progress` le passager est déjà à bord.
       */
      if (
        ride.status === "matched" &&
        !ride.nearNotifiedAt &&
        haversineKm(point, [ride.pickup.lng, ride.pickup.lat]) * 1000 < NEAR_RADIUS_M
      ) {
        await ctx.db.patch(ride._id, { nearNotifiedAt: now });
        const driver = await ctx.db.get(userId);
        await ctx.scheduler.runAfter(0, internal.push.send, {
          userId: ride.riderId,
          title: "Ton chauffeur arrive",
          body: `${driver?.name ?? "Ton chauffeur"} est à moins de ${NEAR_RADIUS_M} m.`,
          url: `/ride/${ride._id}`,
        });
      }

      await joinIfTogether(ctx, ride, point, riderPointOf(ride, rider, now));
      continue;
    }

    // Passager. Une fois à bord, son téléphone vaut celui du chauffeur.
    if (ride.joinedAt) {
      await writePosition(ctx, ride._id, lat, lng, heading, "rider");
      continue;
    }

    const tracked = await positionRow(ctx, ride._id);
    if (tracked) {
      await joinIfTogether(ctx, ride, [tracked.lng, tracked.lat], point);
    }
  }

  return true;
}

/**
 * Réponse du chauffeur à une demande.
 * Accepter engage : la course passe `matched` et lui est attribuée. Refuser
 * l'annule — le passager peut en relancer une en repartageant sa position.
 */
export const respond = mutation({
  args: {
    rideId: v.id("rides"),
    accept: v.boolean(),
  },
  handler: async (ctx, { rideId, accept }) => {
    const me = await currentUser(ctx);
    if (!me) throw new Error("Non authentifié");
    if (me.role !== "driver") throw new Error("Seul un chauffeur peut répondre à une course.");

    const ride = await ctx.db.get(rideId);
    if (!ride) throw new Error("Course introuvable.");
    if (ride.status !== "requested") {
      throw new Error("Cette demande a déjà été traitée.");
    }

    const now = Date.now();
    if (!accept) {
      await ctx.db.patch(rideId, { status: "cancelled", cancelledBy: "driver", endedAt: now });
      return "cancelled" as const;
    }

    await ctx.db.patch(rideId, { status: "matched", driverId: me._id, acceptedAt: now });

    // Première position connue du chauffeur, pour que le passager le voie tout de suite.
    if (me.lastLat != null && me.lastLng != null) {
      await trackRide(ctx, me._id, me.lastLat, me.lastLng);
    }

    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: ride.riderId,
      title: "Course acceptée",
      body: `${me.name} arrive vers toi.`,
      url: `/ride/${rideId}`,
    });

    return "matched" as const;
  },
});

/** Le chauffeur démarre la course une fois le passager à bord. */
export const start = mutation({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const found = await participantIn(ctx, rideId);
    if (!found || found.invited || !found.asDriver) throw new Error("Course introuvable.");
    if (found.ride.status !== "matched") throw new Error("La course ne peut pas démarrer.");

    await ctx.db.patch(rideId, { status: "in_progress", startedAt: Date.now() });
  },
});

/**
 * Clôture de la course, par le chauffeur comme par le passager, à tout moment
 * tant qu'elle est ouverte : sur le terrain, l'un des deux constate la fin du
 * trajet en premier et il n'y a pas de raison de l'obliger à attendre l'autre.
 */
export const complete = mutation({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const found = await participantIn(ctx, rideId);
    if (!found || found.invited) throw new Error("Course introuvable.");
    if (!isActive(found.ride.status)) throw new Error("Cette course est déjà close.");
    // Le passager règle avant de clore ; le chauffeur, lui, peut toujours
    // conclure une course réglée en espèces hors de l'application.
    if (!found.asDriver && !found.ride.paidAt) {
      throw new Error("Règle la course avant d'y mettre fin.");
    }

    const now = Date.now();
    const ride = found.ride;
    await ctx.db.patch(rideId, {
      status: "completed",
      endedAt: now,
      // Terminer sans être passé par « démarrer » reste une course effectuée.
      startedAt: ride.startedAt ?? now,
    });

    const [rider, driver] = await Promise.all([
      ctx.db.get(ride.riderId),
      ride.driverId ? ctx.db.get(ride.driverId) : Promise.resolve(null),
    ]);

    // Montant omis plutôt qu'affiché à zéro quand la course a été réglée
    // en espèces hors de l'application.
    const amount = ride.paidAt ? formatXaf(ride.paymentAmount ?? 0) : null;
    const url = `/ride/${rideId}`;

    await ctx.scheduler.runAfter(0, internal.push.send, {
      userId: ride.riderId,
      title: "Course terminée",
      body: amount
        ? `${amount} réglés à ${driver?.name ?? "ton chauffeur"}. Note ta course.`
        : `Course avec ${driver?.name ?? "ton chauffeur"} terminée. Note ta course.`,
      url,
    });

    if (ride.driverId) {
      await ctx.scheduler.runAfter(0, internal.push.send, {
        userId: ride.driverId,
        title: "Course terminée",
        body: amount
          ? `${amount} reçus de ${rider?.name ?? "ton passager"}.`
          : `Course avec ${rider?.name ?? "ton passager"} terminée.`,
        url,
      });
    }
  },
});

/**
 * Règlement de la course par le passager.
 *
 * ⚠️ Aucun opérateur n'est branché : ni Orange Money ni MTN MoMo n'exposent
 * d'API dans ce projet. Cette mutation **enregistre une intention de paiement**
 * — moyen, montant, numéro crédité — elle ne déplace pas d'argent.
 *
 * Le code secret saisi par le passager n'est jamais transmis ici : il est
 * vérifié côté client pour sa forme puis jeté. Rien dans Convex ne doit pouvoir
 * ressembler à un code confidentiel.
 */
export const pay = mutation({
  args: {
    rideId: v.id("rides"),
    method: v.union(v.literal("orange_money"), v.literal("mtn_momo")),
    amount: v.number(),
  },
  handler: async (ctx, { rideId, method, amount }) => {
    const found = await participantIn(ctx, rideId);
    if (!found || found.invited) throw new Error("Course introuvable.");
    if (found.asDriver) throw new Error("Seul le passager règle la course.");
    if (found.ride.paidAt) throw new Error("Cette course est déjà réglée.");
    if (!isActive(found.ride.status)) throw new Error("Cette course est déjà close.");
    if (!Number.isFinite(amount) || amount <= 0) throw new Error("Montant invalide.");

    const driverId = found.ride.driverId;
    if (!driverId) throw new Error("Aucun chauffeur à créditer.");

    const driver = await ctx.db.get(driverId);
    const toPhone = driver?.phone ? normalizePhone(driver.phone) : null;
    if (!toPhone) {
      throw new Error("Ce chauffeur n'a pas de numéro : impossible de lui transférer le montant.");
    }

    await ctx.db.patch(rideId, {
      paymentMethod: method,
      paymentAmount: Math.round(amount),
      paidAt: Date.now(),
      paidToPhone: toPhone,
    });

    return toPhone;
  },
});

/** Note valide : de 0 à 5, par pas d'une demi-étoile. */
function isValidRating(value: number) {
  return Number.isFinite(value) && value >= 0 && value <= 5 && Number.isInteger(value * 2);
}

/**
 * Le passager note son chauffeur en fin de course.
 *
 * La moyenne du chauffeur est **recalculée depuis ses courses notées** plutôt
 * qu'incrémentée : une note modifiée ou une course supprimée ne peut pas laisser
 * la moyenne dériver.
 */
export const rate = mutation({
  args: {
    rideId: v.id("rides"),
    rating: v.number(),
  },
  handler: async (ctx, { rideId, rating }) => {
    const found = await participantIn(ctx, rideId);
    if (!found) throw new Error("Course introuvable.");
    if (found.asDriver) throw new Error("Seul le passager note son chauffeur.");
    if (found.ride.status !== "completed") {
      throw new Error("La course doit être terminée pour être notée.");
    }
    if (!isValidRating(rating)) {
      throw new Error("Note invalide : de 0 à 5, par demi-étoile.");
    }

    const driverId = found.ride.driverId;
    if (!driverId) throw new Error("Cette course n'a pas de chauffeur.");

    await ctx.db.patch(rideId, { rating, ratedAt: Date.now() });

    const rides = await ctx.db
      .query("rides")
      .withIndex("by_driver", (q) => q.eq("driverId", driverId))
      .collect();

    const scores = rides
      .map((ride) => (ride._id === rideId ? rating : ride.rating))
      .filter((value): value is number => typeof value === "number");

    const average = scores.reduce((total, value) => total + value, 0) / scores.length;
    await ctx.db.patch(driverId, {
      rating: Math.round(average * 100) / 100,
      ratingCount: scores.length,
    });

    return scores.length;
  },
});

/** Annulation par l'une ou l'autre partie, tant que la course n'est pas close. */
export const cancel = mutation({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }) => {
    const found = await participantIn(ctx, rideId);
    if (!found || found.invited) throw new Error("Course introuvable.");
    if (!isActive(found.ride.status)) throw new Error("Cette course est déjà close.");

    await ctx.db.patch(rideId, {
      status: "cancelled",
      cancelledBy: found.asDriver ? "driver" : "rider",
      endedAt: Date.now(),
    });
  },
});

/** Détail d'une course, réservé à ses deux participants. */
export const get = query({
  args: { rideId: v.id("rides") },
  handler: async (ctx, { rideId }): Promise<RideDetail | null> => {
    const found = await participantIn(ctx, rideId);
    if (!found) return null;

    const { ride, me } = found;
    const [summary, riderName, driverName, position] = await Promise.all([
      summarize(ctx, ride, me._id),
      nameOf(ctx, ride.riderId, "Passager"),
      nameOf(ctx, ride.driverId, "Chauffeur"),
      positionRow(ctx, rideId),
    ]);

    // Sur une demande en attente, on montre au chauffeur sollicité son propre
    // véhicule : c'est celui qui servirait la course, donc celui qui la tarife.
    const vehicleOwner = ride.driverId ?? (found.invited ? me._id : null);
    const vehicle = vehicleOwner
      ? await ctx.db
          .query("vehicles")
          .withIndex("by_driver", (q) => q.eq("driverId", vehicleOwner))
          .unique()
      : null;

    const driver = ride.driverId ? await ctx.db.get(ride.driverId) : null;

    return {
      ...summary,
      // `summarize` compare à `driverId`, encore vide sur une course en attente.
      asDriver: found.asDriver,
      canRespond: found.invited && ride.status === "requested",
      driverPhone: driver?.phone ?? null,
      payment: ride.paidAt
        ? {
            method: ride.paymentMethod ?? "orange_money",
            amount: ride.paymentAmount ?? 0,
            paidAt: ride.paidAt,
            toPhone: ride.paidToPhone ?? null,
          }
        : null,
      riderName: riderName ?? "Passager",
      driverName,
      vehicle: vehicle ? { type: vehicle.type, plate: vehicle.plate } : null,
      driverPosition: position
        ? {
            lat: position.lat,
            lng: position.lng,
            heading: position.heading ?? null,
            at: position.updatedAt ?? position._creationTime,
          }
        : null,
    };
  },
});

/** Historique complet de l'utilisateur connecté, tous statuts, plus récent en tête. */
export const listMine = query({
  args: {},
  handler: async (ctx): Promise<RideSummary[]> => {
    const me = await currentUser(ctx);
    if (!me) return [];

    const [asRider, asDriver] = await Promise.all([
      ctx.db
        .query("rides")
        .withIndex("by_rider", (q) => q.eq("riderId", me._id))
        .collect(),
      ctx.db
        .query("rides")
        .withIndex("by_driver", (q) => q.eq("driverId", me._id))
        .collect(),
    ]);

    const seen = new Set<string>();
    const rides = [...asDriver, ...asRider].filter((ride) => {
      if (seen.has(ride._id)) return false;
      seen.add(ride._id);
      return true;
    });

    const summaries = await Promise.all(rides.map((ride) => summarize(ctx, ride, me._id)));
    return summaries.sort((a, b) => b.requestedAt - a.requestedAt);
  },
});

/**
 * Course active de l'utilisateur connecté, s'il y en a une.
 * Côté chauffeur elle déclenche un suivi GPS plus serré ; côté passager elle
 * ouvre le suivi en direct.
 */
export const activeForMe = query({
  args: {},
  handler: async (ctx): Promise<RideSummary | null> => {
    const me = await currentUser(ctx);
    if (!me) return null;

    const [asRider, asDriver] = await Promise.all([
      ctx.db
        .query("rides")
        .withIndex("by_rider", (q) => q.eq("riderId", me._id))
        .collect(),
      ctx.db
        .query("rides")
        .withIndex("by_driver", (q) => q.eq("driverId", me._id))
        .collect(),
    ]);

    const active = [...asDriver, ...asRider]
      .filter((ride) => isActive(ride.status))
      .sort((a, b) => b._creationTime - a._creationTime)[0];

    return active ? summarize(ctx, active, me._id) : null;
  },
});

/**
 * État condensé servant à déclencher les alertes **côté application**.
 *
 * Les notifications locales n'exigent aucune configuration Firebase : le
 * téléphone les affiche lui-même. L'app observe cette requête en temps réel et
 * compare l'état d'un rendu à l'autre — un changement de statut déclenche une
 * bannière. Contrepartie : ça ne fonctionne que si l'application tourne.
 *
 * `nearNotifiedAt` est posé une seule fois par `trackRide` : le client s'en
 * sert comme signal, sans avoir à refaire le calcul de distance.
 */
export const alertState = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentUser(ctx);
    if (!me) return null;

    const [asRider, asDriver] = await Promise.all([
      ctx.db
        .query("rides")
        .withIndex("by_rider", (q) => q.eq("riderId", me._id))
        .collect(),
      ctx.db
        .query("rides")
        .withIndex("by_driver", (q) => q.eq("driverId", me._id))
        .collect(),
    ]);

    // La plus récente, quel que soit son statut : une course qui vient de se
    // terminer doit encore pouvoir déclencher son reçu.
    const mine = [...asDriver, ...asRider].sort((a, b) => b._creationTime - a._creationTime)[0];

    let ride = null;
    if (mine) {
      const summary = await summarize(ctx, mine, me._id);
      ride = {
        id: summary.id,
        status: summary.status,
        counterpart: summary.counterpart,
        asDriver: summary.asDriver,
        paidAmount: summary.paidAmount,
        nearNotifiedAt: mine.nearNotifiedAt ?? null,
      };
    }

    // Demandes en attente adressées à ce chauffeur : la course n'a pas encore
    // de `driverId`, elle ne remonte donc dans aucun des deux index ci-dessus.
    let pending: { id: Id<"rides">; riderName: string }[] = [];
    if (me.role === "driver") {
      const conversations = await ctx.db
        .query("conversations")
        .withIndex("by_driver_key", (q) => q.eq("driverKey", me._id))
        .collect();
      const mineIds = new Set(conversations.map((conversation) => conversation._id));

      if (mineIds.size > 0) {
        const requested = await ctx.db
          .query("rides")
          .withIndex("by_status", (q) => q.eq("status", "requested"))
          .collect();

        pending = await Promise.all(
          requested
            .filter((r) => r.conversationId && mineIds.has(r.conversationId))
            .map(async (r) => ({
              id: r._id,
              riderName: (await nameOf(ctx, r.riderId, "Passager")) ?? "Passager",
            })),
        );
      }
    }

    return { ride, pending };
  },
});
