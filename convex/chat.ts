import { v } from "convex/values";

import { internal } from "./_generated/api";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { RideStatus } from "./rides";
import { currentUser } from "./model/auth";
import type { Doc, Id } from "./_generated/dataModel";

export const MAX_MESSAGE_LENGTH = 2000;
/** Plafond de comptage des non-lus : au-delà on affiche « 49+ ». */
export const UNREAD_CAP = 50;

export type ChatMessage = {
  id: Id<"messages">;
  body: string;
  /** `true` si c'est l'utilisateur connecté qui l'a écrit. */
  mine: boolean;
  sentAt: number;
  /** `"location"` : le message porte des coordonnées exploitables. */
  kind: "text" | "location";
  lat?: number;
  lng?: number;
  placeName?: string;
  /** Course née de ce partage de position, si le chauffeur est un vrai compte. */
  rideId?: Id<"rides">;
  rideStatus?: RideStatus;
};

export type ConversationSummary = {
  id: Id<"conversations">;
  driverKey: string;
  /** Nom de l'interlocuteur : le chauffeur côté passager, et inversement. */
  title: string;
  lastMessageAt: number;
  preview: string | null;
  unread: number;
};

type Side = "rider" | "driver";

/** Fil du passager avec un chauffeur donné (index `by_rider_and_driver`). */
async function conversationFor(ctx: QueryCtx, riderId: Id<"users">, driverKey: string) {
  return ctx.db
    .query("conversations")
    .withIndex("by_rider_and_driver", (q) =>
      q.eq("riderId", riderId).eq("driverKey", driverKey),
    )
    .unique();
}

/**
 * De quel côté du fil se trouve l'utilisateur connecté, ou `null` s'il n'y est
 * pas. Un chauffeur inscrit se reconnaît à `driverKey === son id Convex`.
 */
function sideOf(conversation: Doc<"conversations">, me: Doc<"users">): Side | null {
  if (conversation.riderId === me._id) return "rider";
  if (conversation.driverKey === me._id) return "driver";
  return null;
}

/** Le fil demandé, uniquement si l'utilisateur connecté en fait partie. */
async function participantIn(ctx: QueryCtx, conversationId: Id<"conversations">) {
  const me = await currentUser(ctx);
  if (!me) return null;
  const conversation = await ctx.db.get(conversationId);
  if (!conversation) return null;
  const side = sideOf(conversation, me);
  if (!side) return null;
  return { me, conversation, side };
}

function lastReadOf(conversation: Doc<"conversations">, side: Side): number {
  return (side === "rider" ? conversation.riderLastReadAt : conversation.driverLastReadAt) ?? 0;
}

/** Messages reçus depuis la dernière lecture de ce côté (plafonné). */
async function unreadCount(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  me: Doc<"users">,
  side: Side,
): Promise<number> {
  const since = lastReadOf(conversation, side);
  // Tout index Convex se termine par `_creationTime` : la borne est indexée.
  const recent = await ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) =>
      q.eq("conversationId", conversation._id).gt("_creationTime", since),
    )
    .take(UNREAD_CAP);

  return recent.filter((message) => message.senderId !== me._id).length;
}

async function lastMessageOf(ctx: QueryCtx, conversationId: Id<"conversations">) {
  return ctx.db
    .query("messages")
    .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
    .order("desc")
    .first();
}

/** Nom à afficher en face de soi dans un fil. */
async function titleFor(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  side: Side,
): Promise<string> {
  if (side === "rider") return conversation.driverName;
  const rider = await ctx.db.get(conversation.riderId);
  return rider?.name ?? "Passager";
}

async function summarize(
  ctx: QueryCtx,
  conversation: Doc<"conversations">,
  me: Doc<"users">,
  side: Side,
): Promise<ConversationSummary> {
  const [title, last, unread] = await Promise.all([
    titleFor(ctx, conversation, side),
    lastMessageOf(ctx, conversation._id),
    unreadCount(ctx, conversation, me, side),
  ]);

  return {
    id: conversation._id,
    driverKey: conversation.driverKey,
    title,
    lastMessageAt: conversation.lastMessageAt,
    preview: last ? last.body : null,
    unread,
  };
}

/** Tous les fils de l'utilisateur connecté, quel que soit son rôle. */
async function myConversations(ctx: QueryCtx, me: Doc<"users">) {
  const [asRider, asDriver] = await Promise.all([
    ctx.db
      .query("conversations")
      .withIndex("by_rider", (q) => q.eq("riderId", me._id))
      .collect(),
    ctx.db
      .query("conversations")
      .withIndex("by_driver_key", (q) => q.eq("driverKey", me._id))
      .collect(),
  ]);

  return [
    ...asRider.map((conversation) => ({ conversation, side: "rider" as Side })),
    ...asDriver.map((conversation) => ({ conversation, side: "driver" as Side })),
  ];
}

/**
 * Ouvre (ou retrouve) le fil avec un chauffeur. Idempotent : rejouable à chaque
 * entrée dans l'écran de discussion. Réservé au passager, qui porte le fil.
 */
export const openConversation = mutation({
  args: {
    driverKey: v.string(),
    driverName: v.string(),
  },
  handler: async (ctx, { driverKey, driverName }): Promise<Id<"conversations">> => {
    const me = await currentUser(ctx);
    if (!me) throw new Error("Non authentifié");
    if (me.role !== "rider") throw new Error("Seul un passager peut ouvrir une discussion.");

    const key = driverKey.trim();
    if (!key) throw new Error("Chauffeur inconnu.");

    const name = driverName.trim() || "Chauffeur";
    const existing = await conversationFor(ctx, me._id, key);

    if (existing) {
      // Le chauffeur a pu renommer son profil depuis la dernière discussion.
      if (existing.driverName !== name) await ctx.db.patch(existing._id, { driverName: name });
      return existing._id;
    }

    return ctx.db.insert("conversations", {
      riderId: me._id,
      driverKey: key,
      driverName: name,
      lastMessageAt: Date.now(),
    });
  },
});

/** En-tête d'un fil : nom de l'interlocuteur et côté occupé. */
export const getConversation = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const found = await participantIn(ctx, conversationId);
    if (!found) return null;
    return {
      id: found.conversation._id,
      driverKey: found.conversation.driverKey,
      title: await titleFor(ctx, found.conversation, found.side),
      side: found.side,
    };
  },
});

/** Messages d'un fil, du plus ancien au plus récent. */
export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }): Promise<ChatMessage[]> => {
    const found = await participantIn(ctx, conversationId);
    if (!found) return [];

    const messages = await ctx.db
      .query("messages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();

    return Promise.all(
      messages.map(async (message) => {
        // Le statut est relu à chaque rendu : le widget suit la course en direct.
        const ride = message.rideId ? await ctx.db.get(message.rideId) : null;

        return {
          id: message._id,
          body: message.body,
          mine: message.senderId === found.me._id,
          sentAt: message._creationTime,
          kind: message.kind === "location" ? ("location" as const) : ("text" as const),
          lat: message.lat,
          lng: message.lng,
          placeName: message.placeName,
          rideId: ride?._id,
          rideStatus: ride?.status,
        };
      }),
    );
  },
});

/** Envoie un message dans un fil dont on fait partie — passager comme chauffeur. */
export const sendMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    body: v.string(),
  },
  handler: async (ctx, { conversationId, body }) => {
    const found = await participantIn(ctx, conversationId);
    if (!found) throw new Error("Discussion introuvable.");

    const text = body.trim();
    if (!text) throw new Error("Message vide.");
    if (text.length > MAX_MESSAGE_LENGTH) {
      throw new Error(`Message trop long (${MAX_MESSAGE_LENGTH} caractères maximum).`);
    }

    const now = Date.now();
    await ctx.db.insert("messages", {
      conversationId,
      senderId: found.me._id,
      body: text,
    });

    // Écrire, c'est avoir tout lu de son côté.
    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      ...(found.side === "rider" ? { riderLastReadAt: now } : { driverLastReadAt: now }),
    });
  },
});

/**
 * Partage la position de l'expéditeur dans le fil.
 *
 * Quand c'est le **passager** qui partage et que le fil vise un vrai compte
 * chauffeur, une course `requested` est créée dans la foulée : le chauffeur
 * pourra l'accepter ou la refuser depuis le message. Un fil ouvert avec un
 * profil de test n'en crée aucune — personne ne pourrait y répondre.
 *
 * Le message reste lisible tel quel (`body`) pour les aperçus et les lecteurs
 * d'écran. Au passage, la position du compte est rafraîchie : partager, c'est
 * se déclarer ici et maintenant.
 */
export const shareLocation = mutation({
  args: {
    conversationId: v.id("conversations"),
    lat: v.number(),
    lng: v.number(),
    placeName: v.optional(v.string()),
    /** Destination en cours côté passager, si la discussion vient de la carte. */
    destLat: v.optional(v.number()),
    destLng: v.optional(v.number()),
    destName: v.optional(v.string()),
  },
  handler: async (ctx, { conversationId, lat, lng, placeName, destLat, destLng, destName }) => {
    const found = await participantIn(ctx, conversationId);
    if (!found) throw new Error("Discussion introuvable.");

    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      throw new Error("Coordonnées de position invalides.");
    }

    const place = placeName?.trim() || undefined;
    const now = Date.now();

    // `normalizeId` renvoie `null` pour un `demo-driver-N` : pas de vrai chauffeur.
    const driverId =
      found.side === "rider" ? ctx.db.normalizeId("users", found.conversation.driverKey) : null;

    // Destination explicite si le fil vient de la carte, sinon celle mémorisée
    // sur le profil du passager lors de son choix de lieu.
    const rider = found.side === "rider" ? found.me : await ctx.db.get(found.conversation.riderId);
    const fallbackLat = rider?.pendingDestLat;
    const fallbackLng = rider?.pendingDestLng;

    const toLat = destLat ?? fallbackLat;
    const toLng = destLng ?? fallbackLng;
    const destination =
      toLat != null && toLng != null && Math.abs(toLat) <= 90 && Math.abs(toLng) <= 180
        ? { lat: toLat, lng: toLng }
        : undefined;

    const destinationLabel = destName?.trim() || rider?.pendingDestName;

    const rideId = driverId
      ? await ctx.db.insert("rides", {
          riderId: found.conversation.riderId,
          conversationId,
          status: "requested",
          pickup: { lat, lng },
          pickupName: place,
          destination,
          destinationName: destination ? destinationLabel || undefined : undefined,
        })
      : undefined;

    await ctx.db.insert("messages", {
      conversationId,
      senderId: found.me._id,
      body: place ? `Position partagée — ${place}` : "Position partagée",
      kind: "location",
      lat,
      lng,
      placeName: place,
      rideId,
    });

    await ctx.db.patch(conversationId, {
      lastMessageAt: now,
      ...(found.side === "rider" ? { riderLastReadAt: now } : { driverLastReadAt: now }),
    });

    await ctx.db.patch(found.me._id, { lastLat: lat, lastLng: lng, lastPositionAt: now });

    // Sans cette alerte, le chauffeur ne découvrirait la demande qu'en ouvrant
    // l'application — le passager attendrait pour rien.
    if (rideId && driverId) {
      await ctx.scheduler.runAfter(0, internal.push.send, {
        userId: driverId,
        title: "Nouvelle demande de course",
        body: place
          ? `${found.me.name} t'attend à ${place}.`
          : `${found.me.name} a partagé sa position.`,
        url: `/ride/${rideId}`,
      });
    }

    return rideId ?? null;
  },
});

/** Marque le fil comme lu pour le côté de l'utilisateur connecté. */
export const markRead = mutation({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const found = await participantIn(ctx, conversationId);
    if (!found) return;

    const now = Date.now();
    await ctx.db.patch(conversationId,
      found.side === "rider" ? { riderLastReadAt: now } : { driverLastReadAt: now },
    );
  },
});

/** Fils de l'utilisateur connecté, discussion la plus récente en tête. */
export const listConversations = query({
  args: {},
  handler: async (ctx): Promise<ConversationSummary[]> => {
    const me = await currentUser(ctx);
    if (!me) return [];

    const mine = await myConversations(ctx, me);
    const summaries = await Promise.all(
      mine.map(({ conversation, side }) => summarize(ctx, conversation, me, side)),
    );

    return summaries.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  },
});

/** Total des messages non lus, pour la pastille du bouton messagerie. */
export const unreadTotal = query({
  args: {},
  handler: async (ctx): Promise<number> => {
    const me = await currentUser(ctx);
    if (!me) return 0;

    const mine = await myConversations(ctx, me);
    const counts = await Promise.all(
      mine.map(({ conversation, side }) => unreadCount(ctx, conversation, me, side)),
    );

    return counts.reduce((total, count) => total + count, 0);
  },
});
