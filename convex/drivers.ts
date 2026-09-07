import { v } from "convex/values";

import { query } from "./_generated/server";
import { currentUser } from "./model/auth";
import type { Doc, Id } from "./_generated/dataModel";

/** Ce que le passager reçoit pour chaque chauffeur suggéré. */
export type SuggestedDriver = {
  id: Id<"users">;
  name: string;
  rating: number | null;
  vehicle: { type: string; plate: string } | null;
  /** Disponibilité déclarée par le chauffeur ; `false` tant qu'il n'a rien dit. */
  isAvailable: boolean;
  /** Dernière position connue `[lng, lat]`, ou `null` s'il n'a jamais partagé. */
  position: [number, number] | null;
  /** Distance au passager, `null` si l'une des deux positions manque. */
  distanceKm: number | null;
  lastSeenAt: number | null;
};

const DEFAULT_LIMIT = 8;
const MAX_LIMIT = 30;
/** Marge de lecture avant classement : on trie sur un vivier, pas sur l'ordre d'insertion. */
const SCAN_LIMIT = 100;
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

function positionOf(user: Doc<"users">): [number, number] | null {
  return user.lastLng != null && user.lastLat != null ? [user.lastLng, user.lastLat] : null;
}

/**
 * Classement : disponibles d'abord, puis les plus proches, puis les mieux notés.
 * Un chauffeur sans position connue passe après ceux qu'on sait situer — on ne
 * peut rien promettre sur son délai d'arrivée.
 */
function rank(a: SuggestedDriver, b: SuggestedDriver): number {
  if (a.isAvailable !== b.isAvailable) return a.isAvailable ? -1 : 1;

  const da = a.distanceKm ?? Number.POSITIVE_INFINITY;
  const db = b.distanceKm ?? Number.POSITIVE_INFINITY;
  if (da !== db) return da - db;

  const ra = a.rating ?? -1;
  const rb = b.rating ?? -1;
  if (ra !== rb) return rb - ra;

  return a.name.localeCompare(b.name, "fr");
}

/**
 * Chauffeurs suggérés au passager connecté.
 *
 * Réservé au rôle `rider` : un chauffeur n'a pas à lister ses concurrents, et un
 * visiteur non authentifié n'a rien à voir. Renvoie `[]` (pas une erreur) pour
 * que l'écran reste utilisable pendant le chargement du profil.
 *
 * La position de référence est celle passée par le client (GPS courant), avec
 * repli sur la dernière position enregistrée du passager.
 */
export const listSuggested = query({
  args: {
    limit: v.optional(v.number()),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
  },
  handler: async (ctx, { limit, lat, lng }): Promise<SuggestedDriver[]> => {
    const me = await currentUser(ctx);
    if (!me || me.role !== "rider") return [];

    const take = Math.min(Math.max(Math.trunc(limit ?? DEFAULT_LIMIT), 1), MAX_LIMIT);
    const from =
      lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)
        ? ([lng, lat] as [number, number])
        : positionOf(me);

    const drivers = await ctx.db
      .query("users")
      .withIndex("by_role", (q) => q.eq("role", "driver"))
      .take(SCAN_LIMIT);

    const suggested = await Promise.all(
      drivers.map(async (driver): Promise<SuggestedDriver> => {
        const vehicle = await ctx.db
          .query("vehicles")
          .withIndex("by_driver", (q) => q.eq("driverId", driver._id))
          .unique();

        const position = positionOf(driver);

        return {
          id: driver._id,
          name: driver.name,
          rating: driver.rating ?? null,
          vehicle: vehicle ? { type: vehicle.type, plate: vehicle.plate } : null,
          isAvailable: driver.isAvailable === true,
          position,
          distanceKm: from && position ? haversineKm(from, position) : null,
          lastSeenAt: driver.lastPositionAt ?? null,
        };
      }),
    );

    return suggested.sort(rank).slice(0, take);
  },
});
