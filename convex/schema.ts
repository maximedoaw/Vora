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
    /** Moyenne des notes reçues, recalculée à chaque évaluation de course. */
    rating: v.optional(v.number()),
    ratingCount: v.optional(v.number()),
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
    /**
     * Destination retenue par le passager sur la carte, conservée jusqu'à ce
     * qu'il l'efface. Elle alimente la course créée depuis n'importe quelle
     * discussion, y compris rouverte depuis la boîte de réception.
     */
    pendingDestLat: v.optional(v.number()),
    pendingDestLng: v.optional(v.number()),
    pendingDestName: v.optional(v.string()),
  })
    .index("by_clerk_id", ["clerkId"])
    .index("by_role", ["role"])
    .index("by_name_lower", ["nameLower"]),

  /**
   * Cycle de vie d'une course : `requested` à l'envoi de la position par le
   * passager, `matched` quand le chauffeur accepte, `in_progress` au départ,
   * puis `completed` ou `cancelled` — un refus est un `cancelled` immédiat.
   *
   * `destination` est optionnelle : une course naît d'un partage de position
   * dans la discussion, où seul le point de prise en charge est connu.
   */
  rides: defineTable({
    riderId: v.id("users"),
    driverId: v.optional(v.id("users")),
    /** Fil d'où la course est partie, pour revenir à la discussion. */
    conversationId: v.optional(v.id("conversations")),
    status: v.union(
      v.literal("requested"),
      v.literal("matched"),
      v.literal("in_progress"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    pickup: v.object({ lat: v.number(), lng: v.number() }),
    /** Nom du lieu de prise en charge, tel que géocodé au partage. */
    pickupName: v.optional(v.string()),
    destination: v.optional(v.object({ lat: v.number(), lng: v.number() })),
    destinationName: v.optional(v.string()),
    routeGeometry: v.optional(v.any()), // GeoJSON LineString
    estimatedPrice: v.optional(v.number()),
    estimatedDuration: v.optional(v.number()),
    acceptedAt: v.optional(v.number()),
    startedAt: v.optional(v.number()),
    endedAt: v.optional(v.number()),
    /** Qui a mis fin à la course : utile pour l'historique. */
    cancelledBy: v.optional(v.union(v.literal("rider"), v.literal("driver"))),
    /** Note donnée par le passager, de 0 à 5 par pas de 0,5. */
    rating: v.optional(v.number()),
    ratedAt: v.optional(v.number()),
    /**
     * Règlement de la course par le passager. Le code secret saisi n'est jamais
     * conservé : seuls le moyen, le montant et le numéro crédité le sont.
     */
    paymentMethod: v.optional(v.union(v.literal("orange_money"), v.literal("mtn_momo"))),
    paymentAmount: v.optional(v.number()),
    paidAt: v.optional(v.number()),
    paidToPhone: v.optional(v.string()),
    /** Horodate l'unique alerte « chauffeur à moins de 200 m ». */
    nearNotifiedAt: v.optional(v.number()),
  })
    .index("by_rider", ["riderId"])
    .index("by_driver", ["driverId"])
    .index("by_status", ["status"]),

  /**
   * Jetons de notification Expo, un par appareil.
   *
   * Table à part et non un champ sur `users` : un compte peut être ouvert sur
   * plusieurs téléphones, un téléphone peut changer de compte, et un jeton se
   * révoque tout seul (désinstallation) sans qu'on touche au profil.
   */
  pushTokens: defineTable({
    userId: v.id("users"),
    token: v.string(),
    platform: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_token", ["token"]),

  /** Une ligne par course : la position du chauffeur y est écrasée en place. */
  driverPositions: defineTable({
    rideId: v.id("rides"),
    lat: v.number(),
    lng: v.number(),
    heading: v.optional(v.number()),
    updatedAt: v.optional(v.number()),
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
    /** Course née de ce partage de position, que le chauffeur accepte ou refuse. */
    rideId: v.optional(v.id("rides")),
  }).index("by_conversation", ["conversationId"]),

  alerts: defineTable({
    rideId: v.id("rides"),
    type: v.string(),
    message: v.string(),
  }).index("by_ride", ["rideId"]),
});
