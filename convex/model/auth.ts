import type { QueryCtx } from "../_generated/server";

/**
 * Résolution de l'utilisateur connecté, isolée dans son propre module.
 *
 * `users`, `rides`, `chat` et `drivers` en ont tous besoin ; la placer ici évite
 * que `users` et `rides` s'importent mutuellement — un cycle qui ne tient que
 * par la remontée des déclarations de fonctions.
 */

/** Recherche par identifiant Clerk (index `by_clerk_id`). */
export async function userByClerkId(ctx: QueryCtx, clerkId: string) {
  return ctx.db
    .query("users")
    .withIndex("by_clerk_id", (q) => q.eq("clerkId", clerkId))
    .unique();
}

/** Utilisateur Convex correspondant au JWT Clerk courant, ou `null`. */
export async function currentUser(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return userByClerkId(ctx, identity.subject);
}
