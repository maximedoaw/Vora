/**
 * Reconnaissance d'identité côté Convex via le JWT Clerk.
 * `CLERK_JWT_ISSUER_DOMAIN` = "Frontend API URL" du dashboard Clerk
 * (à définir dans les variables d'environnement du déploiement Convex).
 * `applicationID` doit correspondre au nom du JWT Template Clerk : `convex`.
 */
export default {
  providers: [
    {
      domain: process.env.CLERK_JWT_ISSUER_DOMAIN,
      applicationID: "convex",
    },
  ],
};
