import { v } from "convex/values";

import { internal } from "./_generated/api";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
} from "./_generated/server";
import { currentUser } from "./model/auth";
import type { Id } from "./_generated/dataModel";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
/** L'API Expo n'accepte pas plus de 100 messages par requête. */
const BATCH_SIZE = 100;

type PushTicket = {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
};

/** Un jeton Expo a toujours cette forme ; on refuse le reste sans discuter. */
function looksLikeExpoToken(token: string): boolean {
  return /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token.trim());
}

/**
 * Enregistre le jeton de cet appareil pour l'utilisateur connecté.
 *
 * Idempotente : rejouée à chaque démarrage. Si le jeton est déjà connu, on le
 * réattribue — c'est le cas d'un téléphone prêté, où le compte change mais pas
 * l'appareil.
 */
export const registerToken = mutation({
  args: {
    token: v.string(),
    platform: v.string(),
  },
  handler: async (ctx, { token, platform }) => {
    const me = await currentUser(ctx);
    if (!me) return null;

    const clean = token.trim();
    if (!looksLikeExpoToken(clean)) throw new Error("Jeton de notification invalide.");

    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", clean))
      .unique();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, { userId: me._id, platform, updatedAt: now });
      return existing._id;
    }

    return ctx.db.insert("pushTokens", { userId: me._id, token: clean, platform, updatedAt: now });
  },
});

/**
 * Oublie ce jeton — à la déconnexion.
 * Sans ça, l'appareil continuerait de recevoir les notifications du compte
 * précédent jusqu'à ce que quelqu'un s'y reconnecte.
 */
export const unregisterToken = mutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token.trim()))
      .unique();

    if (existing) await ctx.db.delete(existing._id);
  },
});

export const tokensOf = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }): Promise<string[]> => {
    const rows = await ctx.db
      .query("pushTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.map((row) => row.token);
  },
});

/** Purge d'un jeton mort, signalée par Expo (`DeviceNotRegistered`). */
export const dropToken = internalMutation({
  args: { token: v.string() },
  handler: async (ctx, { token }) => {
    const existing = await ctx.db
      .query("pushTokens")
      .withIndex("by_token", (q) => q.eq("token", token))
      .unique();

    if (existing) await ctx.db.delete(existing._id);
  },
});

/**
 * Envoi d'une notification à tous les appareils d'un utilisateur.
 *
 * Action et non mutation : une mutation Convex ne peut pas faire de `fetch`.
 * Toujours appelée via `ctx.scheduler.runAfter(0, …)` pour qu'un échec d'envoi
 * ne fasse jamais échouer la course ou le message qui l'a déclenchée.
 */
export const send = internalAction({
  args: {
    userId: v.id("users"),
    title: v.string(),
    body: v.string(),
    /** Chemin expo-router ouvert au clic, ex. `/ride/<id>`. */
    url: v.optional(v.string()),
  },
  handler: async (ctx, { userId, title, body, url }) => {
    const tokens: string[] = await ctx.runQuery(internal.push.tokensOf, { userId });
    if (tokens.length === 0) return 0;

    let delivered = 0;

    for (let start = 0; start < tokens.length; start += BATCH_SIZE) {
      const batch = tokens.slice(start, start + BATCH_SIZE);
      const messages = batch.map((to) => ({
        to,
        title,
        body,
        sound: "default",
        channelId: "default",
        data: url ? { url } : {},
      }));

      try {
        const res = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers: {
            accept: "application/json",
            "accept-encoding": "gzip, deflate",
            "content-type": "application/json",
          },
          body: JSON.stringify(messages),
        });

        if (!res.ok) {
          console.warn(`[push] Expo ${res.status}`, (await res.text()).slice(0, 200));
          continue;
        }

        const payload = (await res.json()) as { data?: PushTicket[] };
        const tickets = payload.data ?? [];

        // Les tickets suivent l'ordre des messages envoyés.
        await Promise.all(
          tickets.map(async (ticket, index) => {
            if (ticket.status === "ok") {
              delivered += 1;
              return;
            }
            console.warn("[push] ticket en erreur", ticket.message, ticket.details?.error);
            if (ticket.details?.error === "DeviceNotRegistered") {
              await ctx.runMutation(internal.push.dropToken, { token: batch[index] });
            }
          }),
        );
      } catch (error) {
        console.warn("[push] envoi impossible", error);
      }
    }

    return delivered;
  },
});

/** Raccourci typé pour les mutations qui déclenchent une notification. */
export type PushTarget = { userId: Id<"users">; title: string; body: string; url?: string };
