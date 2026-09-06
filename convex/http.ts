import { httpRouter } from "convex/server";

import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";

/**
 * Webhooks Clerk → Convex.
 *
 * Clerk n'appelle pas le téléphone : il POST vers
 * `https://<deployment>.convex.site/clerk-users-webhook`.
 * Identique pour le web et le mobile.
 *
 * Dashboard Clerk : Webhooks → Add Endpoint, événements `user.created`,
 * `user.updated`, `user.deleted`. Secret `whsec_…` dans Convex :
 * `CLERK_WEBHOOK_SECRET`.
 *
 * La signature Svix est vérifiée avec Web Crypto (runtime Convex),
 * sans le paquet `svix` (Node 22+, incompatible ici).
 */
const http = httpRouter();

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const event = await validateRequest(request);
    if (!event) {
      return new Response("Webhook Clerk invalide", { status: 400 });
    }

    switch (event.type) {
      case "user.created":
      case "user.updated":
        await ctx.runMutation(internal.users.upsertFromClerk, { data: event.data });
        break;
      case "user.deleted": {
        const clerkUserId = event.data?.id;
        if (typeof clerkUserId === "string") {
          await ctx.runMutation(internal.users.deleteFromClerk, { clerkUserId });
        }
        break;
      }
      default:
        console.log("[clerk webhook] ignoré", event.type);
    }

    return new Response(null, { status: 200 });
  }),
});

type ClerkWebhookEvent = {
  type: string;
  data: { id?: string };
};

const TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

async function validateRequest(req: Request): Promise<ClerkWebhookEvent | null> {
  const secret = process.env.CLERK_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[clerk webhook] CLERK_WEBHOOK_SECRET manquant");
    return null;
  }

  const payloadString = await req.text();
  const id = req.headers.get("svix-id") ?? "";
  const timestamp = req.headers.get("svix-timestamp") ?? "";
  const signatureHeader = req.headers.get("svix-signature") ?? "";

  if (!id || !timestamp || !signatureHeader) {
    console.error("[clerk webhook] en-têtes Svix manquants");
    return null;
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts * 1000) > TIMESTAMP_TOLERANCE_MS) {
    console.error("[clerk webhook] timestamp hors tolérance");
    return null;
  }

  const expected = await hmacSha256(decodeWhsec(secret), `${id}.${timestamp}.${payloadString}`);
  const match = parseSignatures(signatureHeader).some((sig) =>
    timingSafeEqual(base64ToBytes(sig), expected),
  );

  if (!match) {
    console.error("[clerk webhook] signature invalide");
    return null;
  }

  try {
    return JSON.parse(payloadString) as ClerkWebhookEvent;
  } catch (error) {
    console.error("[clerk webhook] JSON invalide", error);
    return null;
  }
}

function decodeWhsec(secret: string): Uint8Array {
  const b64 = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  return base64ToBytes(b64);
}

function parseSignatures(header: string): string[] {
  return header
    .split(" ")
    .map((part) => {
      const comma = part.indexOf(",");
      return comma === -1 ? "" : part.slice(comma + 1);
    })
    .filter(Boolean);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function hmacSha256(secret: Uint8Array, message: string): Promise<Uint8Array> {
  const keyBytes = new Uint8Array(secret.byteLength);
  keyBytes.set(secret);
  const key = await crypto.subtle.importKey(
    "raw",
    keyBytes as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default http;
