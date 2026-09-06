import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Schéma complet posé dès la Phase 0 (roadmap) — toutes les tables ne sont pas
 * utilisées avant la Phase 4.
 *
 * Écart assumé vs roadmap : `users.role` est **optionnel**. `syncUser` crée
 * l'utilisateur à la première connexion sans rôle ; l'écran d'onboarding appelle
 * ensuite `completeOnboarding`.
 */
export default defineSchema({
  users: defineTable({
    clerkId: v.string(),
    role: v.optional(v.union(v.literal("rider"), v.literal("driver"))),
    name: v.string(),
    /** Normalisé (minuscules) pour l'unicité du nom d'utilisateur à l'onboarding. */
    nameLower: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    rating: v.optional(v.number()),
    /**
     * Dernière position connue, enregistrée dès la première autorisation GPS
     * puis rafraîchie toutes les 2-3 minutes. Optionnelle : un compte peut
     * exister sans avoir jamais accordé la localisation.
     */
    lastLat: v.optional(v.number()),
    lastLng: v.optional(v.number()),
    lastPositionAt: v.optional(v.number()),
    /**
     * Disponibilité déclarée par le chauffeur depuis son espace. Absent =
     * jamais renseigné, traité comme indisponible dans le classement.
     */
    isAvailable: v.optional(v.boolean()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_role", ["role"])
    .index("by_name_lower", ["nameLower"]),

  rides: defineTable({
    riderId: v.id("users"),
    driverId: v.optional(v.id("users")),
    status: v.union(
      v.literal("requested"),
      v.literal("matched"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    pickup: v.object({ lat: v.number(), lng: v.number() }),
    destination: v.object({ lat: v.number(), lng: v.number() }),
    routeGeometry: v.optional(v.any()), // GeoJSON LineString
    estimatedPrice: v.optional(v.number()),
    estimatedDuration: v.optional(v.number()),
  })
    .index("by_rider", ["riderId"])
    .index("by_driver", ["driverId"])
    .index("by_status", ["status"]),

  driverPositions: defineTable({
    rideId: v.id("rides"),
    lat: v.number(),
    lng: v.number(),
    heading: v.optional(v.number()),
  }).index("by_ride", ["rideId"]),

  vehicles: defineTable({
    driverId: v.id("users"),
    type: v.string(),
    plate: v.string(),
  }).index("by_driver", ["driverId"]),

  /**
   * Fil de discussion passager ↔ chauffeur.
   * `driverKey` : id Convex du chauffeur s'il est inscrit, sinon identifiant du
   * chauffeur simulé (`demo-driver-N`) — le fil reste porté par le passager.
   *
   * `*LastReadAt` : horodatage du dernier message vu par chaque côté, d'où se
   * déduit le compteur de non-lus. Optionnels : un fil jamais ouvert = tout est neuf.
   */
  conversations: defineTable({
    riderId: v.id("users"),
    driverKey: v.string(),
    driverName: v.string(),
    lastMessageAt: v.number(),
    riderLastReadAt: v.optional(v.number()),
    driverLastReadAt: v.optional(v.number()),
  })
    .index("by_rider_and_driver", ["riderId", "driverKey"])
    .index("by_rider", ["riderId"])
    .index("by_driver_key", ["driverKey"]),

  /**
   * `kind` absent = message texte ordinaire. `"location"` = position partagée :
   * `body` reste rempli (aperçus, accessibilité) et les coordonnées servent au
   * tracé vers le client.
   */
  messages: defineTable({
    conversationId: v.id("conversations"),
    senderId: v.id("users"),
    body: v.string(),
    kind: v.optional(v.literal("location")),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    placeName: v.optional(v.string()),
  }).index("by_conversation", ["conversationId"]),

  alerts: defineTable({
    rideId: v.id("rides"),
    type: v.string(),
    message: v.string(),
  }).index("by_ride", ["rideId"]),
});
