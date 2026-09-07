# Vora — Fiche technique du projet

> **Consigne pour la génération du PDF**
> Ce document doit être transformé en un fichier **PDF au format A4, fond blanc uni,
> texte entièrement noir**. Aucune couleur d'accent, aucun aplat coloré, aucun fond
> gris : uniquement du noir sur blanc. Les titres se distinguent par la taille et la
> graisse, les tableaux par de fins filets noirs. Police sans-serif lisible
> (Helvetica / Arial / Inter), corps de texte ~11 pt, marges confortables,
> numérotation des pages en bas.

---

## 1. Présentation

**Vora** est une application mobile de **VTC (transport de personnes à la demande)**
conçue pour le marché camerounais, et plus précisément la ville de **Yaoundé**.
Elle met en relation deux rôles au sein d'une même application :

- le **passager** (*rider*) : il se localise, choisit une destination, consulte les
  chauffeurs proches, discute avec eux, partage sa position, suit la course, paie et note ;
- le **chauffeur** (*driver*) : il déclare sa disponibilité, reçoit les demandes,
  accepte ou refuse, démarre et termine la course.

Sa particularité fonctionnelle est le **trajet partagé** (section 4.8) : plusieurs
passagers allant dans la même direction montent dans le même véhicule et se
répartissent le tarif en fonction de la portion d'itinéraire que chacun occupe.

Le rôle est choisi une seule fois, à l'*onboarding*, après la création du compte.

Particularités du produit : interface **entièrement en français**, tarification en
**FCFA (XAF)**, paiement par **Mobile Money** (Orange Money et MTN MoMo), et
validation des numéros de téléphone selon les **préfixes opérateurs camerounais**.

---

## 2. Stack technique

### 2.1 Vue d'ensemble

| Couche | Technologie |
|---|---|
| Application mobile & web | React Native 0.86.3 + React 19.2.3 |
| Framework / toolchain | Expo SDK 57 (`expo ~57.0.20`) |
| Navigation | Expo Router (routage par fichiers, `typedRoutes` activé) |
| Langage | TypeScript ~6.0.3 |
| Backend & base de données | Convex ^1.45 (serverless temps réel) |
| Authentification | Clerk (`@clerk/expo` ^4.6.5) |
| Cartographie | MapLibre GL + tuiles MapTiler |
| Calcul d'itinéraires | OpenRouteService (HeiGIT) |
| Géocodage | Photon (OpenStreetMap) + repli MapTiler |
| Notifications | `expo-notifications` + Expo Push API |
| Icônes | `lucide-react-native` |
| Build & distribution | EAS Build (`eas.json`, profils dev / preview / production) |
| Lint | ESLint 9 + `eslint-config-expo` |

### 2.2 Front-end — Expo / React Native

- **Expo SDK 57**, avec le **React Compiler** activé (`experiments.reactCompiler: true`)
  et les **routes typées** (`experiments.typedRoutes: true`).
- Cible **Android**, **iOS** et **Web** (`react-native-web`, sortie web statique).
  Certains modules ont une variante web dédiée (`*.web.tsx`) : carte, thème, icônes animées.
- Modules Expo utilisés : `expo-router`, `expo-location`, `expo-notifications`,
  `expo-secure-store`, `expo-splash-screen`, `expo-image`, `expo-linear-gradient`,
  `expo-glass-effect`, `expo-symbols`, `expo-web-browser`, `expo-auth-session`,
  `expo-crypto`, `expo-device`, `expo-constants`, `expo-system-ui`, `expo-font`.
- Animation & gestes : `react-native-reanimated` 4.5.1, `react-native-worklets`,
  `react-native-gesture-handler`, `react-native-screens`, `react-native-safe-area-context`.
- Rendu vectoriel : `react-native-svg`. Carte native : `react-native-webview`.
- **Identifiants applicatifs** : `com.vora.app` (Android et iOS), schéma d'URL `vora://`.

### 2.3 Backend — Convex

Convex tient à la fois de la base de données, de la couche API et du moteur temps
réel : les `query` sont **réactives** (l'écran se met à jour sans rafraîchissement
manuel), les `mutation` sont transactionnelles, les `action` autorisent les appels
réseau sortants.

Modules serveur (`convex/`) :

| Fichier | Rôle |
|---|---|
| `schema.ts` | Schéma de la base (tables, index, validateurs) |
| `users.ts` | Synchronisation Clerk, onboarding, position, disponibilité, destination |
| `rides.ts` | Cycle de vie complet d'une course (accepter, démarrer, terminer, payer, noter, annuler) |
| `chat.ts` | Conversations, messages, partage de position, non-lus |
| `drivers.ts` | Suggestion et classement des chauffeurs proches |
| `routing.ts` | Proxy serveur vers OpenRouteService |
| `sharing.ts` | Trajet partagé : ouverture au partage, arrivée des compagnons, montées et descentes |
| `push.ts` | Enregistrement des jetons et envoi via l'API Expo Push |
| `http.ts` | Point d'entrée HTTP des webhooks Clerk |
| `auth.config.ts` | Validation du JWT Clerk côté Convex |
| `model/` | Logique partagée (authentification, téléphone, géométrie, passagers de test) |

### 2.4 Authentification — Clerk

- `ClerkProvider` en racine, jetons persistés via **`expo-secure-store`**.
- Pont `ConvexProviderWithClerk` : le **JWT Clerk** (template nommé `convex`) est
  vérifié par Convex à chaque requête ; l'identité de l'appelant est donc garantie côté serveur.
- **Webhooks Clerk → Convex** (`user.created`, `user.updated`, `user.deleted`) sur
  `/clerk-users-webhook`, avec **vérification maison de la signature Svix**
  (HMAC-SHA256 via Web Crypto, comparaison à temps constant, tolérance d'horodatage
  de 5 minutes) — le paquet `svix` étant incompatible avec le runtime Convex.
- Méthodes d'inscription : e-mail et OAuth (`expo-auth-session`, `expo-web-browser`).

---

## 3. Modèle de données

Neuf tables Convex, toutes indexées :

| Table | Contenu | Index |
|---|---|---|
| `users` | `clerkId`, rôle (`rider` / `driver`), nom, e-mail, téléphone, note moyenne, dernière position GPS, disponibilité, destination en attente | `by_clerk_id`, `by_role`, `by_name_lower` |
| `rides` | Passager, chauffeur, statut, point de prise en charge, destination, géométrie de l'itinéraire, prix et durée estimés, horodatages (dont la jonction à 5 m), note, paiement, partage | `by_rider`, `by_driver`, `by_status` |
| `conversations` | Fil passager ↔ chauffeur, dernier message, derniers accusés de lecture des deux côtés | `by_rider_and_driver`, `by_rider`, `by_driver_key` |
| `messages` | Texte ou **position partagée** (`kind: "location"` avec coordonnées), lien éventuel vers une course | `by_conversation` |
| `driverPositions` | Position temps réel du véhicule pendant une course, avec le téléphone qui l'a rapportée (une ligne par course, écrasée en place) | `by_ride` |
| `pushTokens` | Un jeton Expo par appareil (un compte peut avoir plusieurs téléphones) | `by_user`, `by_token` |
| `vehicles` | Type de véhicule et plaque d'immatriculation du chauffeur | `by_driver` |
| `rideCompanions` | Passagers partageant la course d'un autre : montée et descente exprimées en progression sur l'itinéraire | `by_ride` |
| `alerts` | Alertes liées à une course | `by_ride` |

**Cycle de vie d'une course :**
`requested` → `matched` → `in_progress` → `completed`, avec `cancelled` possible à
tout moment (un refus du chauffeur est une annulation immédiate). Le champ
`cancelledBy` conserve qui a mis fin à la course.

---

## 4. Fonctionnalités principales

### 4.1 Géolocalisation et suivi de course
- Une **veille GPS unique** pour toute l'application authentifiée
  (`GeolocationProvider`), plutôt qu'un abonnement par écran.
- **Cadence adaptée à l'étape**, et non fixe : 2 min 30 au repos, 15 s pour le
  chauffeur pendant son approche, 30 s pour le passager qui l'attend, et **1 min
  pour les deux une fois à bord**. Un garde-fou serveur ignore les écritures trop
  rapprochées (2 min au repos, 20 s en course).
- **Jonction à 5 m.** Tant que ni le chauffeur ni le passager n'a annulé ou clos la
  course, le serveur compare leurs deux positions à chaque point reçu. Sous
  **5 mètres**, ils sont considérés ensemble : la course passe d'elle-même en
  `in_progress`, les deux reçoivent une notification, et le trajet vers la
  destination commence. Le bouton « Démarrer la course » reste disponible — la
  jonction automatique est un accélérateur, pas l'unique chemin, car 5 m est plus
  fin que la précision d'un GPS de téléphone en ville.
- **Les deux téléphones alimentent la même position** une fois à bord : ils sont au
  même endroit, et l'un des deux peut avoir l'application en arrière-plan. Le
  champ `driverPositions.source` garde la trace de qui a rapporté le point.
- Permissions déclarées pour Android (`ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`)
  et iOS (`NSLocationWhenInUseUsageDescription`), avec messages explicatifs en français.

### 4.2 Cartographie
- **MapLibre GL** rendu dans une **WebView** en natif (HTML généré à la volée par
  `map-html.ts`), et directement via `maplibre-gl` sur le web.
- Tuiles **MapTiler** (`streets-v2` / `streets-v2-dark`), style suivant le thème
  clair/sombre de l'application ; repli sur les tuiles de démonstration MapLibre si
  la clé est absente.
- Centre par défaut : **Yaoundé** (11.5021, 3.848). Marqueurs voiture en SVG,
  simplification (*downsampling*) des tracés d'itinéraire avant transmission à la WebView.
- Recherche de lieux via **Photon** (OpenStreetMap), avec repli **MapTiler**,
  restreinte au Cameroun par défaut (`EXPO_PUBLIC_GEOCODING_COUNTRY=CM`).
- **Vue 3D**, accessible au passager comme au chauffeur par un bouton posé sur la
  carte : caméra inclinée à 58°, **bâtiments extrudés** (`fill-extrusion`) et
  **suivi orienté dans le sens de la marche** — le cap est calculé sur le tronçon
  d'itinéraire qui suit la position courante. Déplacer la carte à la main coupe le
  suivi, et le bouton propose alors de recentrer plutôt que de quitter la 3D. La
  source des bâtiments est repérée par sa couche dans le style courant, jamais
  codée en dur : un style qui n'en a pas reste incliné, simplement sans relief.
- **Simulation de trajet**, déclenchée par un bouton dès qu'un itinéraire est
  tracé : un véhicule parcourt le tracé à la **vitesse moyenne que le service de
  routage a estimée pour cet itinéraire**, en 2D comme en 3D, caméra centrée sur
  lui et orientée dans le sens de la marche. Le profil de vitesse tient compte
  des **virages** — la vitesse décroît avec le changement de cap sur les 40 m à
  venir, jusqu'au pas d'homme dans une épingle — et des **obstacles** : un
  changement de direction franc (> 70°) est traité comme un carrefour où l'on
  marque l'arrêt, d'autant plus long que l'angle est fermé. **Le tracé déjà
  parcouru s'efface derrière le véhicule** — seul ce qu'il reste à faire est
  dessiné, comme sur les applications de course. Le bouton compte trois états :
  lancer, mettre en pause, **reprendre là où le véhicule s'est arrêté** — la
  pause fige l'avancement et la reprise recule l'origine des temps d'autant,
  jamais un redémarrage depuis le début.

### 4.3 Itinéraires et tarification
- Itinéraires réels via **OpenRouteService**, appelé en priorité sur le nouvel hôte
  **`api.heigit.org`**, l'ancien `api.openrouteservice.org` ne servant que de filet
  (déprécié, extinction annoncée).
- **Repli hors-ligne / hors-quota** : estimation à vol d'oiseau corrigée d'un facteur
  de détour routier de 1,4 et d'une vitesse moyenne de 26 km/h. Le résultat indique
  toujours sa source (`ors` ou `estimate`).
- Grille tarifaire par **type de véhicule** (moto, berline, SUV, van) : prise en
  charge minimale, prix au kilomètre, prix à la minute, franchise et prix d'attente —
  calibrée sur les tarifs publics pratiqués à Yaoundé, en FCFA.

### 4.4 Messagerie
- Conversation par binôme passager ↔ chauffeur, temps réel via Convex.
- **Partage de position** dans le fil : un message de type `location` déclenche la
  création d'une course que le chauffeur accepte ou refuse.
- Compteurs de **non-lus** déduits des horodatages de dernière lecture de chaque côté ;
  boîte de réception avec badge global.

### 4.5 Notifications
- **Notifications locales** opérationnelles (alertes de course, chauffeur à moins de
  200 m signalé une seule fois par course grâce à `nearNotifiedAt`).
- Chargement **défensif** d'`expo-notifications` : sous Expo Go sur Android, le seul
  fait d'importer le module fait tomber l'application ; l'application détecte
  l'environnement et se désactive proprement. Un *development build* est requis
  (`npx expo run:android`), sans configuration Firebase pour le local.
- **Push distant** : couche serveur déjà écrite (`convex/push.ts`) — validation du
  format des jetons Expo, envoi par lots de 100 à l'API `exp.host`, purge des jetons
  révoqués, réattribution idempotente quand un appareil change de compte.

### 4.6 Paiement Mobile Money
- Deux moyens : **Orange Money** et **MTN Mobile Money**, choisis dans une feuille modale.
- Validation stricte des numéros camerounais (`+237`, 9 chiffres) avec **détection
  automatique de l'opérateur** par préfixe : MTN `67x`, `68x`, `650–654` ;
  Orange `69x`, `655–659`.
- Règle de sécurité assumée : **le code secret saisi n'est jamais conservé**. Seuls le
  moyen de paiement, le montant et le numéro crédité sont enregistrés sur la course.
- Validation dupliquée volontairement côté client et côté serveur (`src/lib/phone.ts`
  et `convex/model/phone.ts`) : retour immédiat à la saisie, le serveur restant la référence.

### 4.7 Notation
- Le passager note la course de 0 à 5 par pas de 0,5 (`star-rating.tsx`).
- La moyenne du chauffeur (`rating`, `ratingCount`) est recalculée à chaque évaluation.

### 4.8 Trajet partagé (covoiturage)
Fonctionnalité distinctive de Vora face à un VTC classique : le passager peut
**ouvrir sa course** à d'autres personnes allant dans la même direction, sans
qu'elles aient la même destination.

- **Regroupement par direction, pas par destination.** Chaque compagnon est
  situé par sa **progression** sur l'itinéraire du passager principal — `0` au
  point de prise en charge, `1` à la destination. Deux nombres suffisent à
  décrire qui monte où et descend où, sans stocker de polyligne côté serveur.
- **Remplissage immédiat des places.** Quand le chauffeur dépose quelqu'un, la
  place libérée est aussitôt reproposée à un passager situé **plus loin sur la
  route**, jamais derrière le véhicule.
- **Répartition du tarif au segment, et non à parts égales.** L'itinéraire est
  découpé aux montées et aux descentes ; le coût de chaque segment est divisé
  entre les seules personnes à bord **sur ce segment**, et la part de chacun est
  la somme de ses segments. Descendre tôt coûte donc moins cher que d'aller
  jusqu'à la destination la plus éloignée, et la fin du trajet — souvent
  parcourue seul — reste payée plein tarif par celui qui la parcourt.
- **Deux garde-fous** : personne ne descend sous la prise en charge minimale du
  véhicule, et **personne ne paie plus que son trajet seul**.
- **Effet mesuré** sur une berline de 12 km / 30 min (tarif plein 1 825 FCFA) :
  avec deux compagnons, le passager principal paie 1 050 FCFA (−42 %) tandis que
  la recette du chauffeur passe de 1 825 à 2 050 FCFA.
- **Passagers de test** : faute d'un vivier réel, deux profils simulés sont
  ajoutés sur l'itinéraire **deux minutes** après l'activation du partage, via le
  `scheduler` Convex — l'attente survit donc à la mise en arrière-plan de
  l'application. Ils sont signalés comme profils de test dans l'interface.

### 4.9 Suggestion de chauffeurs
Classement serveur des chauffeurs sur un vivier de 100 profils, selon trois critères
successifs : **disponibles d'abord**, puis **les plus proches** (distance de
Haversine), puis **les mieux notés**. Un chauffeur sans position connue est
systématiquement relégué, faute de délai d'arrivée estimable.

---

## 5. Architecture de l'application

### 5.1 Arborescence

```
vora/
├── src/
│   ├── app/                     # Routes Expo Router
│   │   ├── _layout.tsx          # Providers (Clerk → Convex → Thème → GPS)
│   │   ├── index.tsx            # Carte principale
│   │   ├── pickup.tsx           # Choix du point de prise en charge
│   │   ├── messages.tsx         # Boîte de réception
│   │   ├── chat/[driverKey].tsx # Conversation
│   │   ├── rides.tsx            # Historique des courses
│   │   ├── ride/[rideId].tsx    # Suivi d'une course
│   │   └── profile.tsx          # Profil et réglages
│   ├── components/
│   │   ├── auth/                # Écrans et formulaires d'authentification
│   │   ├── map/                 # Carte, recherche de lieu, suggestions, overlays
│   │   ├── ui/                  # Composants génériques
│   │   └── ...                  # Paiement, trajet partagé, notation, onboarding
│   ├── hooks/                   # GPS, itinéraire, thème, push, alertes, chauffeurs
│   ├── lib/                     # Géocodage, routage, simulation, tarifs, partage
│   └── constants/theme.ts       # Palette claire / sombre
├── convex/                      # Backend (schéma, requêtes, mutations, actions)
│   └── model/                   # Auth, téléphone, géométrie, passagers de test
├── docs/                        # Notes de conception et plans techniques
├── assets/                      # Icônes, logos opérateurs, splash
├── app.json / app.config.js     # Configuration Expo (statique + dynamique)
└── eas.json                     # Profils de build EAS
```

### 5.2 Chaîne de providers

```
ClerkProvider
  └── ConvexProviderWithClerk          (JWT transmis à chaque requête)
      └── AppThemeProvider             (thème clair / sombre)
          └── AuthedApp                (profil, jeton push, alertes de course)
              └── GeolocationProvider  (veille GPS unique)
                  └── Stack Expo Router
```

Tant que le profil Convex n'est pas chargé, un écran d'attente s'affiche sous le
splash ; si la synchronisation échoue, un écran d'erreur propose de réessayer ; si le
rôle n'est pas encore choisi, l'onboarding s'affiche avant toute autre route.

### 5.3 Fiche de suivi repliable
L'écran de course superpose sa fiche de détails à la carte. Elle se **plie et se
déplie** sur son en-tête (`LinearTransition` de Reanimated), qui conserve replié
l'essentiel — distance, durée et montant à régler — pour rendre le trajet au
regard sans quitter la course.

### 5.4 Thème
Palette double **clair / sombre** définie dans `constants/theme.ts`, suivant le
réglage système (`userInterfaceStyle: "automatic"`) et propagée jusqu'au style de la
carte MapLibre.

---

## 6. Configuration et déploiement

### 6.1 Variables d'environnement

| Variable | Emplacement | Usage |
|---|---|---|
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | `.env.local` | Client Clerk |
| `EXPO_PUBLIC_CONVEX_URL` | `.env.local` | Déploiement Convex |
| `EXPO_PUBLIC_MAPTILER_KEY` | `.env.local` | Tuiles carte + repli géocodage |
| `ORS_API_KEY` / `EXPO_PUBLIC_ORS_API_KEY` | `.env.local` | Itinéraires OpenRouteService |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | `.env.local` | Configuration Android |
| `EXPO_PUBLIC_GEOCODING_COUNTRY` | `.env.local` | Pays de recherche (défaut `CM`) |
| `CLERK_JWT_ISSUER_DOMAIN` | Convex | Vérification du JWT |
| `CLERK_WEBHOOK_SECRET` | Convex | Vérification de la signature Svix |

`app.config.js` étend `app.json` à la volée pour injecter les clés lues dans
l'environnement, afin qu'aucun secret ne soit versionné.

### 6.2 Commandes

| Commande | Effet |
|---|---|
| `npm start` | Serveur de développement Expo |
| `npm run android` / `npm run ios` | Development build natif |
| `npm run web` | Version web |
| `npm run lint` | ESLint |
| `npx convex dev` | Backend Convex en développement |

### 6.3 Build
**EAS Build** avec trois profils : `development` (client de développement,
distribution interne), `preview` (distribution interne) et `production`
(incrémentation automatique de version, versions gérées à distance).

---

## 7. Choix techniques notables

1. **Convex plutôt qu'une API REST classique** — le temps réel (position du chauffeur,
   messages, statut de course) est natif, sans WebSocket à écrire ni cache à invalider.
2. **MapLibre en WebView plutôt qu'un SDK natif** — un seul moteur de carte et un seul
   code de rendu partagés entre Android, iOS et le web, sans dépendance à Google Maps.
3. **Double hôte OpenRouteService avec repli calculé** — l'application donne toujours
   une distance, une durée et un prix, même sans réseau ni quota.
4. **Vérification manuelle de la signature Svix** — le paquet officiel exigeant Node,
   incompatible avec le runtime Convex ; réécrit avec Web Crypto.
5. **Jetons push dans une table dédiée** — un compte peut vivre sur plusieurs
   téléphones, un téléphone changer de compte, et un jeton se révoquer seul, sans
   toucher au profil utilisateur.
6. **Code secret de paiement jamais persisté** — seule la trace comptable de la
   transaction est conservée.
7. **Validation du téléphone dupliquée client/serveur** — retour immédiat à la saisie
   sans aller-retour réseau, le serveur restant la source de vérité.
8. **Partage du trajet découpé en segments** — le prorata de distance seul
   ignorerait qu'une portion parcourue à trois coûte moins cher, par tête,
   qu'une portion parcourue seul ; le découpage aux montées et aux descentes
   restitue exactement cette réalité.
9. **Le serveur du partage ne connaît aucun prix** — `convex/sharing.ts` ne
   tient que qui monte, où et jusqu'où ; la répartition est calculée par
   `src/lib/shared-ride.ts`, là où vit déjà la grille tarifaire, plutôt que de
   dupliquer les tarifs des deux côtés.
10. **Position du véhicule écrasée en place** — une ligne par course plutôt qu'un
   historique de points, pour ne pas gonfler la base inutilement.
11. **La jonction est détectée côté serveur, pas côté application** — les deux
   téléphones envoient leur position, Convex sérialise les mutations et pose le
   drapeau dans la transaction qui le teste : deux points arrivés coup sur coup
   ne peuvent pas démarrer la course deux fois.
12. **La 3D repère sa source de bâtiments par introspection du style** — plutôt
   qu'un nom de source figé, qui casserait au premier changement de style
   MapTiler ou sur les tuiles de démonstration.
13. **La simulation est planifiée, pas intégrée image par image** — le profil de
   vitesse produit une suite de positions horodatées (`src/lib/route-sim.ts`),
   que les deux moteurs de carte se contentent d'interpoler. La physique est
   ainsi écrite **une seule fois**, alors que la carte native vit dans une
   WebView et la carte web dans la page : deux intégrations parallèles auraient
   fini par diverger. Elle est aussi vérifiable sans rendu — ligne droite
   conforme à la durée théorique, virage à 90° plus lent, lacets deux fois plus
   lents. Chaque image porte aussi l'indice du segment qu'elle occupe : c'est
   lui qui permet d'effacer le tracé derrière le véhicule sans rechercher le
   point le plus proche à chaque image.

---

## 8. Pistes ouvertes

- **Push distant** : le serveur est prêt, il reste à raccorder Firebase Cloud
  Messaging et le jeton Expo pour recevoir les alertes application fermée
  (`docs/push-notifications-plan.md`).
- **Accessibilité** : 25 `accessibilityLabel` répartis dans 12 fichiers ; la carte,
  les marqueurs de chauffeur et la liste des courses restent à couvrir. Un plan
  explore par ailleurs l'apport de **Hume AI** pour des interactions vocales, en
  complément — et non en remplacement — de TalkBack
  (`docs/hume-ai-accessibilite-plan.md`).
- **Intégration réelle des API Mobile Money** (Orange Money, MTN MoMo), le flux
  actuel étant une saisie encadrée côté application.
