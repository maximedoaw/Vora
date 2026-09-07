import { v } from "convex/values";
import { internalMutation, mutation, query, type QueryCtx } from "./_generated/server";
import { currentUser, userByClerkId } from "./model/auth";
import { normalizePhone, phoneError } from "./model/phone";
import { trackRide } from "./rides";

export const MIN_NAME_LENGTH = 2;
export const MAX_NAME_LENGTH = 40;

/** Payload Clerk `user.*` : on ne valide pas le schéma, on fait confiance au webhook signé. */
type ClerkUserPayload = {
  id?: string;
  first_name?: string | null;
  last_name?: string | null;
  username?: string | null;
  email_addresses?: { id: string; email_address: string }[];
  primary_email_address_id?: string | null;
};

function normalizeName(name: string) {
  return name.trim();
}

function nameKey(name: string) {
  return normalizeName(name).toLowerCase();
}

async function findByNameLower(ctx: QueryCtx, nameLower: string) {
  return ctx.db
    .query("users")
    .withIndex("by_name_lower", (q) => q.eq("nameLower", nameLower))
    .unique();
}

function emailFromClerk(data: ClerkUserPayload) {
  const emails = data.email_addresses ?? [];
  const primary = emails.find((item) => item.id === data.primary_email_address_id);
  return primary?.email_address ?? emails[0]?.email_address;
}

function nameFromClerk(data: ClerkUserPayload) {
  const full = [data.first_name, data.last_name].filter(Boolean).join(" ").trim();
  if (full) return full;
  if (data.username?.trim()) return data.username.trim();
  const email = emailFromClerk(data);
  if (email) return email.split("@")[0] ?? "Utilisateur";
  return "Utilisateur";
}

/**
 * Crée l'utilisateur Convex à la première connexion s'il n'existe pas.
 * Filet de sécurité si le webhook Clerk n'est pas encore arrivé (latence mobile).
 */
export const syncUser = mutation({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Non authentifié");

    const existing = await userByClerkId(ctx, identity.subject);
    const email = identity.email ?? undefined;

    if (existing) {
      if (email && existing.email !== email) {
        await ctx.db.patch(existing._id, { email });
      }
      return existing._id;
    }

    return ctx.db.insert("users", {
      clerkId: identity.subject,
      name: normalizeName(name) || "Utilisateur",
      email,
    });
  },
});

/** Profil de l'utilisateur connecté (rôle compris), ou `null`. */
export const getMe = query({
  args: {},
  handler: async (ctx) => currentUser(ctx),
});

/** `true` si un autre compte utilise déjà ce nom (insensible à la casse). */
export const isNameTaken = query({
  args: { name: v.string() },
  handler: async (ctx, { name }) => {
    const key = nameKey(name);
    if (key.length < MIN_NAME_LENGTH) return false;

    const me = await currentUser(ctx);
    const taken = await findByNameLower(ctx, key);
    return !!taken && taken._id !== me?._id;
  },
});

/**
 * Fin d'onboarding : rôle + nom d'utilisateur unique, et véhicule si chauffeur.
 * Une seule mutation = une seule transaction : impossible de se retrouver
 * chauffeur sans véhicule enregistré.
 */
export const completeOnboarding = mutation({
  args: {
    role: v.union(v.literal("rider"), v.literal("driver")),
    name: v.string(),
    /** 9 chiffres locaux ou forme complète : normalisé en `+237…`. */
    phone: v.string(),
    vehicle: v.optional(v.object({ type: v.string(), plate: v.string() })),
  },
  handler: async (ctx, { role, name, phone, vehicle }) => {
    const user = await currentUser(ctx);
    if (!user) throw new Error("Utilisateur introuvable — sync d'abord.");

    const cleanName = normalizeName(name);
    if (cleanName.length < MIN_NAME_LENGTH || cleanName.length > MAX_NAME_LENGTH) {
      throw new Error(
        `Le nom doit faire entre ${MIN_NAME_LENGTH} et ${MAX_NAME_LENGTH} caractères.`,
      );
    }

    const key = nameKey(cleanName);
    const taken = await findByNameLower(ctx, key);
    if (taken && taken._id !== user._id) {
      throw new Error("Ce nom d'utilisateur est déjà pris.");
    }

    // Obligatoire pour tous : un chauffeur doit être payable, un passager
    // joignable, et le paiement mobile passe par ce numéro dans les deux sens.
    const phoneProblem = phoneError(phone);
    if (phoneProblem) throw new Error(phoneProblem);
    const cleanPhone = normalizePhone(phone)!;

    await ctx.db.patch(user._id, {
      role,
      name: cleanName,
      nameLower: key,
      phone: cleanPhone,
    });

    if (role !== "driver") return;

    // S'inscrire comme chauffeur, c'est se déclarer prêt à conduire ; il coupera
    // sa disponibilité depuis son espace quand il ne l'est plus.
    await ctx.db.patch(user._id, { isAvailable: true });

    const type = vehicle?.type.trim() ?? "";
    const plate = vehicle?.plate.trim().toUpperCase() ?? "";
    if (!type) throw new Error("Type de véhicule requis.");
    if (plate.length < 4) throw new Error("Plaque d'immatriculation invalide.");

    const existing = await ctx.db
      .query("vehicles")
      .withIndex("by_driver", (q) => q.eq("driverId", user._id))
      .unique();

    if (existing) await ctx.db.patch(existing._id, { type, plate });
    else await ctx.db.insert("vehicles", { driverId: user._id, type, plate });
  },
});

/** Intervalle minimal entre deux écritures de position (2 minutes). */
export const POSITION_MIN_INTERVAL_MS = 120_000;

/**
 * Rythme resserré pendant une course, chauffeur comme passager.
 *
 * La jonction à 5 m se teste contre la dernière position connue du passager :
 * la laisser vieillir deux minutes reviendrait à comparer le véhicule à un
 * point où le passager n'est plus.
 */
export const RIDE_POSITION_MIN_INTERVAL_MS = 20_000;

function isCoordinate(lat: number, lng: number) {
  return (
    Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
  );
}

/**
 * Enregistre la position courante de l'utilisateur connecté.
 *
 * Le client appelle dès la première autorisation GPS puis toutes les 2-3 min ;
 * ce garde-fou serveur ignore les appels trop rapprochés pour qu'un client
 * bavard (ou rejoué) ne transforme pas `users` en journal de trajet.
 */
export const updatePosition = mutation({
  args: {
    lat: v.number(),
    lng: v.number(),
    /** Force l'écriture — première position d'un compte, ou partage explicite. */
    immediate: v.optional(v.boolean()),
  },
  handler: async (ctx, { lat, lng, immediate }) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    if (!isCoordinate(lat, lng)) throw new Error("Coordonnées de position invalides.");

    const now = Date.now();
    const last = user.lastPositionAt ?? 0;

    /*
     * Le suivi de course passe avant le garde-fou : il n'est jamais throttlé,
     * et les deux parties l'alimentent — le chauffeur pendant son approche, les
     * deux une fois à bord. Le rôle ne suffit donc plus à décider qui écrit,
     * c'est la course qui tranche.
     */
    const onRide = await trackRide(ctx, user._id, lat, lng);

    const minInterval = onRide ? RIDE_POSITION_MIN_INTERVAL_MS : POSITION_MIN_INTERVAL_MS;
    if (!immediate && now - last < minInterval) return user.lastPositionAt ?? null;

    await ctx.db.patch(user._id, { lastLat: lat, lastLng: lng, lastPositionAt: now });
    return now;
  },
});

/**
 * Mémorise la destination choisie par le passager sur la carte.
 *
 * Sans argument, elle est effacée. La garder en base — plutôt que de la trimballer
 * dans les paramètres de navigation — permet à une course créée depuis un fil
 * rouvert d'avoir malgré tout son point d'arrivée.
 */
export const setDestination = mutation({
  args: {
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    name: v.optional(v.string()),
  },
  handler: async (ctx, { lat, lng, name }) => {
    const user = await currentUser(ctx);
    if (!user) return null;

    const valid =
      lat != null &&
      lng != null &&
      Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lng) <= 180;

    await ctx.db.patch(user._id, {
      pendingDestLat: valid ? lat : undefined,
      pendingDestLng: valid ? lng : undefined,
      pendingDestName: valid ? name?.trim() || undefined : undefined,
    });

    return valid;
  },
});

/**
 * Le chauffeur se déclare disponible ou non depuis son espace.
 * Un passager n'a rien à basculer : la course se demande, elle ne se déclare pas.
 */
export const setAvailability = mutation({
  args: { isAvailable: v.boolean() },
  handler: async (ctx, { isAvailable }) => {
    const user = await currentUser(ctx);
    if (!user) throw new Error("Non authentifié");
    if (user.role !== "driver") throw new Error("Réservé aux chauffeurs.");

    await ctx.db.patch(user._id, { isAvailable });
    return isAvailable;
  },
});

/** Véhicule du chauffeur connecté, ou `null`. */
export const getMyVehicle = query({
  args: {},
  handler: async (ctx) => {
    const user = await currentUser(ctx);
    if (!user) return null;
    return ctx.db
      .query("vehicles")
      .withIndex("by_driver", (q) => q.eq("driverId", user._id))
      .unique();
  },
});

/**
 * Appelé par le webhook Clerk (`user.created` / `user.updated`).
 * Ne touche pas au rôle ni au nom choisi à l'onboarding.
 */
export const upsertFromClerk = internalMutation({
  args: { data: v.any() },
  handler: async (ctx, { data }) => {
    const payload = data as ClerkUserPayload;
    const clerkId = payload.id;
    if (!clerkId) {
      console.warn("[clerk webhook] user sans id, ignoré");
      return;
    }

    const email = emailFromClerk(payload);
    const existing = await userByClerkId(ctx, clerkId);

    if (!existing) {
      await ctx.db.insert("users", {
        clerkId,
        name: nameFromClerk(payload),
        email,
      });
      return;
    }

    const patch: { email?: string; name?: string } = {};
    if (email && existing.email !== email) patch.email = email;
    // Tant que l'onboarding n'est pas fini, on peut rafraîchir le nom Clerk (SSO Google).
    if (!existing.role) {
      const clerkName = nameFromClerk(payload);
      if (clerkName !== existing.name) patch.name = clerkName;
    }

    if (Object.keys(patch).length > 0) {
      await ctx.db.patch(existing._id, patch);
    }
  },
});

/** Compte Clerk supprimé : on retire le profil Vora et son véhicule. */
export const deleteFromClerk = internalMutation({
  args: { clerkUserId: v.string() },
  handler: async (ctx, { clerkUserId }) => {
    const user = await userByClerkId(ctx, clerkUserId);
    if (!user) {
      console.warn(`[clerk webhook] suppression : aucun user pour ${clerkUserId}`);
      return;
    }

    const vehicle = await ctx.db
      .query("vehicles")
      .withIndex("by_driver", (q) => q.eq("driverId", user._id))
      .unique();
    if (vehicle) await ctx.db.delete(vehicle._id);

    await ctx.db.delete(user._id);
  },
});
