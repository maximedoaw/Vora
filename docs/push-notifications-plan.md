# Plan — Notifications push Vora (Android)

> ## ⚡ État actuel : les notifications marchent, sans Firebase
>
> Les alertes de course sont **implémentées** via des notifications **locales**
> (`src/hooks/use-ride-alerts.ts`). Elles ne demandent **aucune configuration** :
> ni Firebase, ni clé FCM, ni keystore.
>
> **Mais elles exigent un build de développement.** Sous Expo Go, le simple
> chargement d'`expo-notifications` fait tomber l'application sur Android : son
> point d'entrée réexporte `DevicePushTokenAutoRegistration.fx`, qui appelle
> `addPushTokenListener()` au niveau module, et cette fonction `throw` sous
> Expo Go depuis le SDK 53. L'application détecte l'environnement et désactive
> proprement les notifications — elle ne plante plus, mais elle n'en affiche
> aucune.
>
> ```sh
> npx expo run:android      # suffit : aucun dashboard, aucune clé
> ```
>
> Leur autre limite : elles ne s'affichent que si l'application tourne. App
> fermée par l'utilisateur ou tuée par Android → rien.
>
> Tout ce qui suit décrit le **push distant**, la couche qui lèverait cette
> seconde limite. Le code serveur est déjà écrit (`convex/push.ts`) et attend
> la clé FCM.
>
> | | Configuration | Expo Go | Build de dév. | App fermée |
> |---|---|---|---|---|
> | **Local** (en place) | aucune | ❌ | ✅ | ❌ |
> | **Push distant** (§3) | Firebase + clé FCM | ❌ | ✅ | ✅ |

## 1. Comment ça marche, en une page

Si tu n'as jamais fait de push, c'est le passage à lire. Quatre acteurs :

```
   ton app Android          Expo Push Service         Firebase (FCM)        le téléphone
   ───────────────          ─────────────────         ──────────────        ────────────
1. demande un jeton  ──────────────►
                             renvoie
   ExponentPushToken[…] ◄──────────
2. l'envoie à Convex
   (table pushTokens)

3. Convex veut notifier ───────────►  traduit en
                                      message FCM ─────────►  livre ────────►  bannière
                                                                               + son
```

- **Firebase Cloud Messaging (FCM)** est le service de Google qui délivre
réellement la notification sur les téléphones Android. **Il est obligatoire**,
il n'y a pas d'alternative sur Android.
- **Expo Push Service** est un intermédiaire gratuit fourni par Expo. Il te
donne un jeton unique par appareil (`ExponentPushToken[…]`) et se charge de
parler à FCM à ta place. Sans lui, il faudrait manipuler les jetons FCM bruts
et signer des requêtes OAuth — beaucoup plus lourd.
- Tu dois quand même **créer un projet Firebase** et donner ses clés à Expo,
pour qu'Expo ait le droit d'envoyer au nom de ton application.
- **Convex** est notre serveur : c'est lui qui décide quand envoyer, et qui
appelle Expo Push Service en HTTP.

Le jeton `ExponentPushToken[…]` est **par appareil, pas par compte**. Un même
utilisateur sur deux téléphones a deux jetons ; un même téléphone prêté à deux
comptes réutilise le même jeton. D'où la table dédiée en §4.

---



## 2. Librairies à installer



### Côté application

```sh
npx expo install expo-notifications expo-device
```


| Paquet               | Rôle                                                                                                 | Déjà présent ? |
| -------------------- | ---------------------------------------------------------------------------------------------------- | -------------- |
| `expo-notifications` | Permissions, jeton, canal Android, affichage, écouteurs de clic                                      | ❌ à installer  |
| `expo-device`        | Distinguer un vrai téléphone d'un émulateur (le push ne marche pas sur émulateur sans Play Services) | ❌ à installer  |
| `expo-constants`     | Lire le `projectId` EAS depuis la config                                                             | ✅ `~57.0.17`   |
| `expo-router`        | Ouvrir le bon écran au clic (`router.push`)                                                          | ✅              |


`expo-notifications` contient du code natif → **rebuild obligatoire**
(`npx expo run:android`) après installation. Metro seul ne suffira pas.

### Côté serveur (Convex)

**Aucune librairie.** On appelle l'API HTTP d'Expo avec `fetch`, déjà disponible
dans le runtime Convex.

> On pourrait utiliser `expo-server-sdk`, mais c'est un paquet Node : il
> obligerait à passer l'action Convex en `"use node"`, ce qui la rend plus lente
> à démarrer. Pour trois champs JSON à poster, ça n'en vaut pas la peine.



### Outillage

```sh
npm install --global eas-cli   # ou npx eas-cli@latest à chaque appel
```

---



## 3. Configuration des dashboards — le pas-à-pas

C'est la partie où l'on se perd. Fais-la dans l'ordre, elle n'est à faire
**qu'une seule fois**.

### 3.1 Compte Expo et identifiant de projet

Aujourd'hui `app.json` n'a ni `owner` ni `extra.eas.projectId` : le projet
n'existe pas encore côté Expo. **Rien ne peut fonctionner sans ça** —
`getExpoPushTokenAsync` exige cet identifiant.

1. Crée un compte sur **[expo.dev](https://expo.dev)** (gratuit).
2. À la racine du projet :
  ```sh
   npx eas-cli@latest login
   npx eas-cli@latest init
  ```
3. `eas init` crée le projet sur expo.dev et **écrit tout seul** dans
   `app.json` :

   ```json
   "owner": "ton-compte-expo",
   "extra": { "eas": { "projectId": "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" } }
   ```

> ⚠️ `app.json` est lu par `app.config.js`, qui fait déjà un `...appJson.expo`.
> Le `projectId` sera donc bien propagé — mais **vérifie** après `eas init` que
> `npx expo config --type public --json` le montre toujours.



### 3.2 Projet Firebase

C'est ce qui donne à Expo le droit d'envoyer à ton application.

1. Va sur **[console.firebase.google.com](https://console.firebase.google.com)**
  → **Créer un projet** → nomme-le `vora` → tu peux **désactiver Google
   Analytics** (inutile ici).
2. Dans le projet, clique l'icône **Android** pour ajouter une application.
3. **Nom du package Android** : il doit être **exactement**
  ```
   com.vora.app
  ```
   C'est la valeur de `expo.android.package` dans `app.json`. Une faute de
   frappe ici et les notifications ne partiront jamais, sans erreur explicite.
   Le surnom et le certificat SHA-1 peuvent rester vides.
4. Télécharge le fichier `google-services.json` proposé à l'étape suivante.
  Ignore les instructions Gradle qui suivent : Expo s'en charge.



### 3.3 Placer `google-services.json`

1. Copie le fichier à la racine du projet : `./google-services.json`.
2. Déclare-le dans `app.json` :
  ```json
   "android": {
     "package": "com.vora.app",
     "googleServicesFile": "./google-services.json",
     …
   }
  ```
3. **Ajoute-le à** `.gitignore` — il contient des identifiants de projet :
  ```
   google-services.json
  ```



### 3.4 Clé de compte de service FCM V1

Expo doit s'authentifier auprès de FCM pour envoyer en ton nom. Google a
abandonné les anciennes « clés serveur » : il faut désormais une clé de **compte
de service**, au format JSON.

1. Firebase Console → roue dentée **Paramètres du projet** → onglet **Comptes de
  service**.
2. Bouton **Générer une nouvelle clé privée** → **Générer la clé**.
3. Un fichier `.json` se télécharge. **C'est un secret** : il ne va ni dans git,
  ni dans le dossier du projet.
4. Il faut maintenant remettre ce fichier à Expo. **Deux chemins au choix, le
   résultat est identique** — prends le premier si tu débutes.

#### Chemin A — depuis le site expo.dev (recommandé, que des clics)

1. Va sur **[expo.dev](https://expo.dev)**, connecte-toi, ouvre le projet `vora`.
2. Menu de gauche : **Project settings** → **Credentials**.
3. Clique sur l'identifiant Android **`com.vora.app`**.
4. Descends jusqu'à **Service Credentials** → **FCM V1 service account key**.
5. **Add a service account key** → dépose le `.json` téléchargé à l'étape 3 →
   **Save**.

C'est tout. Rien à taper.

#### Chemin B — en ligne de commande

⚠️ **Ce n'est pas une commande à copier en un bloc.** Tu lances *une seule*
commande, puis le terminal te pose des **questions** auxquelles tu réponds avec
les **flèches ↑ ↓ du clavier** et **Entrée**. Les `→` du plan représentaient ces
réponses successives, pas du texte à saisir — d'où la confusion, désolé.

Dans le terminal intégré de ton IDE (VS Code : ``Ctrl + ` ``), à la racine du
projet :

```sh
npx eas-cli@latest credentials
```

Puis, question après question :

```
? Select platform ›
❯ Android            ← flèches pour surligner « Android », puis Entrée
  iOS

? Which build profile do you want to configure? ›
❯ production         ← Entrée
  development

? What do you want to do? ›
  Keystore: Manage everything needed to build your project
❯ Google Service Account          ← descends jusqu'ici, Entrée
  Push Notifications: Manage your FCM Api Key

? What do you want to do? ›
❯ Manage your Google Service Account Key for Push Notifications (FCM V1)

? What do you want to do? ›
❯ Set up a Google Service Account Key for Push Notifications (FCM V1)

? Select a Google Service Account key ›
❯ [chemin détecté vers ton fichier .json]     ← il le trouve tout seul
```

Termine par `q` ou `Ctrl + C` pour quitter le menu.

**Deux mots de vocabulaire qui déroutent :**

- **`production`** est le nom d'un *profil de build* EAS, pas un déploiement en
  ligne. Les clés push sont rangées par profil ; `production` est celui par
  défaut. Tu ne publies rien en choisissant ça.
- **« Google Service Account »** est le nom Google d'un compte technique, non
  humain, qui agit au nom de ton projet. C'est ce que contient le `.json`.

Le libellé exact des menus bouge d'une version d'`eas-cli` à l'autre. Si une
ligne ne correspond pas mot pour mot, cherche celle qui parle de **FCM V1** :
c'est toujours la bonne.



### 3.4 bis — Ce qu'il ne faut PAS faire

Sur la page Credentials d'expo.dev, la section **Build Credentials** propose
d'ajouter un **Android upload keystore** (`Keystore.jks`, mots de passe, alias).

**Ça n'a rien à voir avec les notifications.** Un keystore sert à signer un APK
pour le Play Store. Tu n'as aucun de ces champs à remplir : le jour où tu feras
un build cloud, `eas build -p android` génère le keystore tout seul, et en local
`npx expo run:android` utilise celui de debug.

La seule section qui compte ici est **Service Credentials → FCM V1 service
account key**, et elle ne demande **qu'un fichier**, aucun mot de passe.

### 3.5 Si les clés d'API Google sont restreintes

Si tu as restreint des clés dans Google Cloud Console, autorise explicitement :

- **Firebase Cloud Messaging API**
- **Firebase Installations API**

Sinon le téléphone n'obtiendra jamais de jeton, avec une erreur peu bavarde.

### 3.6 Rebuild

```sh
npx expo run:android
```

Sans ce rebuild, ni `expo-notifications` ni `google-services.json` ne sont dans
l'APK.

### Récapitulatif des comptes à créer


| Service                                         | Coût                        | Ce qu'on y fait                                 |
| ----------------------------------------------- | --------------------------- | ----------------------------------------------- |
| [expo.dev](https://expo.dev)                    | Gratuit                     | `projectId`, dépôt de la clé FCM                |
| [Firebase](https://console.firebase.google.com) | Gratuit (plan Spark suffit) | Projet + app Android + clé de compte de service |
| Google Play Console                             | **Pas nécessaire**          | — (seulement pour publier sur le Store)         |


---



## 4. Modèle de données



### Nouvelle table `pushTokens`

```ts
pushTokens: defineTable({
  userId: v.id("users"),
  token: v.string(),          // ExponentPushToken[xxxxxxxx]
  platform: v.string(),       // "android" | "ios"
  updatedAt: v.number(),
})
  .index("by_user", ["userId"])
  .index("by_token", ["token"]),
```

Table séparée plutôt qu'un champ sur `users` : un compte peut être ouvert sur
plusieurs appareils, un appareil peut changer de compte, et un jeton se révoque
tout seul (désinstallation) sans qu'on ait à toucher au profil.

### Champ à ajouter sur `rides`

```ts
nearNotifiedAt: v.optional(v.number()),   // anti-doublon des « moins de 200 m »
```

---



## 5. Enregistrement du jeton (client)

Nouveau `src/hooks/use-push-token.ts`, monté dans `AuthedApp` à côté de
`GeolocationProvider` :

1. `setNotificationHandler` au chargement du module — décide de l'affichage
  quand l'app est au premier plan (`shouldShowBanner`, `shouldPlaySound`). Le
   handler doit répondre **en moins de 3 secondes**.
2. Sur Android, **avant tout** :
  ```ts
   await Notifications.setNotificationChannelAsync('default', {
     name: 'Courses',
     importance: Notifications.AndroidImportance.MAX,
     vibrationPattern: [0, 250, 250, 250],
     lightColor: '#1ED760',
   });
  ```
   Depuis Android 8, une notification sans canal n'est pas affichée. Sans appel
   explicite, un canal « Miscellaneous » est créé à notre place — moche et non
   traduit.
3. `Device.isDevice` : sur émulateur sans Play Services, on abandonne
  silencieusement.
4. `getPermissionsAsync` → si `undetermined`, `requestPermissionsAsync`.
  Android 13+ affiche une vraie demande ; refusée, elle n'est pas redemandable.
5. ```ts
  const projectId =
     Constants?.expoConfig?.extra?.eas?.projectId ?? Constants?.easConfig?.projectId;
   const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
   ```
6. Mutation `push.registerToken({ token, platform })` — idempotente via l'index
  `by_token` : si le jeton existe, on met à jour `userId` et `updatedAt`.
7. À la déconnexion (`profile.tsx`, avant `signOut`) :
  `push.unregisterToken({ token })`. Sinon l'appareil continue de recevoir les
   notifications du compte précédent.

**Écueil** : `getExpoPushTokenAsync` lève une exception hors ligne. L'envelopper
et réessayer au prochain démarrage, sans bloquer le rendu.

---

## 6. Envoi (serveur)

### `convex/push.ts`

```ts
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export const send = internalAction({
  args: { userId: v.id("users"), title: v.string(), body: v.string(), url: v.optional(v.string()) },
  handler: async (ctx, { userId, title, body, url }) => {
    const tokens = await ctx.runQuery(internal.push.tokensOf, { userId });
    if (tokens.length === 0) return;

    const res = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        accept: "application/json",
        "accept-encoding": "gzip, deflate",
        "content-type": "application/json",
      },
      body: JSON.stringify(
        tokens.map((to) => ({ to, title, body, sound: "default", data: { url } })),
      ),
    });
    // → lire les tickets, purger les jetons DeviceNotRegistered
  },
});
```

Contraintes de l'API Expo, bonnes à connaître :


| Limite               | Valeur                                |
| -------------------- | ------------------------------------- |
| Messages par requête | **100**                               |
| Débit                | 600 notifications/seconde par projet  |
| Taille du message    | 4096 octets (`MessageTooBig` au-delà) |


**Tickets et reçus** : la réponse de `/send` ne prouve pas la livraison, juste
qu'Expo a pris le message. Le vrai verdict arrive dans les *reçus*
(`https://exp.host/--/api/v2/push/getReceipts`), à consulter ~15 min après
(effacés au bout de 24 h). Codes à traiter :

- `DeviceNotRegistered` → supprimer le jeton de la table. C'est le seul
vraiment important : sans ça la table se remplit d'appareils désinstallés.
- `MessageTooBig`, `MessageRateExceeded`, `MismatchSenderId` (mauvaise clé FCM),
`InvalidCredentials`.

Pour la v1 : traiter `DeviceNotRegistered` sur les **tickets** suffit ; les reçus
peuvent attendre une phase 2.

### Déclenchement depuis les mutations

```ts
await ctx.scheduler.runAfter(0, internal.push.send, { … });
```

Jamais d'appel direct : **une mutation Convex ne peut pas faire de** `fetch`, et
on veut qu'un échec d'envoi ne fasse pas échouer la course.

---

## 7. Les quatre cas d'usage

### 7.1 Compte créé avec succès


|                     |                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Type**            | Notification **locale**, pas un push                                                                                                                                                                                           |
| **Où**              | `onboarding-screen.tsx`, après le succès de `completeOnboarding`                                                                                                                                                               |
| **Pourquoi locale** | L'utilisateur a l'app ouverte sous les yeux et son jeton n'est peut-être pas encore enregistré. Un aller-retour serveur pour notifier quelqu'un qui regarde l'écran n'a pas de sens — et ça marche même sans avoir fini la §3. |
| **Texte**           | « Bienvenue sur Vora » / « Ton compte *passager* est prêt. »                                                                                                                                                                   |


```ts
await Notifications.scheduleNotificationAsync({ content: { … }, trigger: null });
```

### 7.2 Un chauffeur accepte la course


|                  |                                                          |
| ---------------- | -------------------------------------------------------- |
| **Type**         | Push                                                     |
| **Où**           | `rides.respond`, branche `accept === true`               |
| **Destinataire** | Le passager (`ride.riderId`)                             |
| **Texte**        | « Course acceptée » / « *Awono Serge* arrive vers toi. » |
| **Données**      | `{ url: '/ride/<rideId>' }`                              |
| **Idempotence**  | Naturelle : `respond` refuse tout statut ≠ `requested`.  |


**À prévoir aussi** (pas demandé, mais ça manquera vite) : notifier le
**chauffeur** à la création de la demande dans `chat.shareLocation`. Sinon il ne
saura qu'une course l'attend qu'en ouvrant l'app.

### 7.3 Fin de course / reçu


|                   |                                                                              |
| ----------------- | ---------------------------------------------------------------------------- |
| **Type**          | Push                                                                         |
| **Où**            | `rides.complete`                                                             |
| **Destinataires** | **Les deux**, textes différents                                              |
| **Passager**      | « Course terminée » / « 2 450 FCFA réglés à *Awono Serge*. Note ta course. » |
| **Chauffeur**     | « Course terminée » / « 2 450 FCFA reçus de *Maxime D.* »                    |
| **Données**       | `{ url: '/ride/<rideId>' }` — le passager tombe sur le bloc de notation      |
| **Idempotence**   | `complete` refuse une course déjà close.                                     |


Le montant vient de `ride.paymentAmount` ; s'il est absent (chauffeur qui clôt un
paiement espèces), on omet la ligne plutôt que d'afficher `0 FCFA`.

### 7.4 Le chauffeur est à moins de 200 m — **une seule fois**

Le cas le plus délicat : il n'y a pas d'événement, seulement un flux de
positions.


|                  |                                                                                 |
| ---------------- | ------------------------------------------------------------------------------- |
| **Type**         | Push                                                                            |
| **Où**           | `trackDriver` (`convex/rides.ts`), déjà appelée à chaque `users.updatePosition` |
| **Destinataire** | Le passager                                                                     |
| **Condition**    | `status === 'matched'` **et** distance < 200 m **et** `nearNotifiedAt == null`  |
| **Texte**        | « Ton chauffeur arrive » / « *Awono Serge* est à moins de 200 m. »              |


```ts
// dans la boucle de trackDriver, après le patch de la position
if (
  ride.status === "matched" &&
  !ride.nearNotifiedAt &&
  haversineKm([lng, lat], [ride.pickup.lng, ride.pickup.lat]) * 1000 < NEAR_RADIUS_M
) {
  await ctx.db.patch(ride._id, { nearNotifiedAt: now });   // le drapeau AVANT l'envoi
  await ctx.scheduler.runAfter(0, internal.push.send, { … });
}
```

**Le drapeau se pose dans la même mutation que la lecture** : c'est ce qui rend
l'envoi unique. Convex sérialise les transactions, deux positions arrivées coup
sur coup ne peuvent pas passer toutes les deux le test.

Points de vigilance :

- Statut `matched` seulement. En `in_progress` le passager est à bord.
- Le suivi est à **15 s pendant une course** (`use-geo.tsx`) : au pire 200 m
sont franchis entre deux points à 48 km/h — acceptable en ville.
- On ne réarme jamais le drapeau, même si le chauffeur s'éloigne puis revient.
« Une seule fois » est la règle demandée, et ça évite le harcèlement.
- `NEAR_RADIUS_M = 200` en constante, à côté du seuil de 300 m du recalcul
d'itinéraire, pour qu'on voie les deux ensemble.

---

## 8. Ouverture au bon endroit

`addNotificationResponseReceivedListener` → `router.push(data.url)`.

À placer dans `AuthedApp`, pas dans un écran : la notification peut être touchée
app fermée, l'écran de destination n'existe pas encore. Ajouter
`useLastNotificationResponse()` pour le démarrage à froid.

---

## 9. Réglages dans la page compte

Une section « Notifications » avec un interrupteur par famille (`courses`,
`messages`), stockée comme la préférence de thème. Sans ça, la seule issue pour
l'utilisateur est de tout couper au niveau du système, et on ne le saura jamais.

---

## 10. Ordre d'implémentation


| #   | Étape                                                                      | Vérification                                                                                                    |
| --- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 1   | `eas init` → `projectId`                                                   | `npx expo config --type public --json` le montre                                                                |
| 2   | Firebase : projet + app `com.vora.app` + `google-services.json`            | Fichier présent, `.gitignore` à jour                                                                            |
| 3 | Clé de compte de service déposée chez Expo (§3.4, chemin A ou B) | expo.dev → Credentials montre « FCM V1 service account key » |
| 4   | `npx expo install expo-notifications expo-device` + `npx expo run:android` | L'app démarre                                                                                                   |
| 5   | Cas **7.1** (local, aucune dépendance serveur)                             | Une bannière s'affiche à la fin de l'onboarding                                                                 |
| 6   | Table `pushTokens` + `registerToken` / `unregisterToken`                   | Le jeton apparaît dans la table après connexion                                                                 |
| 7   | `use-push-token.ts` monté dans `AuthedApp`                                 | Idem sur un second appareil                                                                                     |
| 8   | `convex/push.ts`                                                           | [expo.dev/notifications](https://expo.dev/notifications) : coller le jeton, envoyer un test, la bannière arrive |
| 9   | Cas **7.2** et **7.3**                                                     | Deux appareils                                                                                                  |
| 10  | Cas **7.4** (`nearNotifiedAt`)                                             | Une seule notification sur tout un trajet                                                                       |
| 11  | Liens profonds (§8)                                                        | Le clic ouvre la bonne course                                                                                   |
| 12  | Réglages (§9)                                                              | —                                                                                                               |


L'étape 8 est le vrai point de bascule : l'outil de test d'Expo permet de
valider toute la §3 **avant** d'écrire la moindre ligne de serveur. Si la
notification n'arrive pas là, le problème est dans les dashboards, pas dans le
code.

---

## 11. Ce qui restera à faire pour iOS

- Créer le dossier natif (`npx expo prebuild -p ios`) — impossible sous Windows
sans machine Mac ou build EAS.
- **Compte Apple Developer payant (99 $/an)** : c'est le vrai coût.
- Générer une clé **APNs** dans le portail Apple et la déposer dans les
credentials Expo, exactement comme la clé FCM.
- Sur iOS, lire `ios.status` et non le `status` racine pour interpréter la
réponse de permission.

---

## 12. Hors périmètre pour l'instant

- **Nouveau message** dans une discussion : utile, mais volume bien plus élevé —
à traiter avec un regroupement, sinon c'est intenable.
- Notifications programmées (rappel de course à venir) : Vora n'a pas de courses
planifiées.
- Images et actions rapides dans la notification.

---

## 13. Pannes courantes, et où regarder


| Symptôme                                            | Cause la plus probable                                                  |
| --------------------------------------------------- | ----------------------------------------------------------------------- |
| `getExpoPushTokenAsync` lève « No projectId found » | §3.1 non faite, ou `app.config.js` n'a pas propagé `extra.eas`          |
| Jeton obtenu, mais rien n'arrive                    | Clé FCM V1 absente ou déposée sur le mauvais identifiant Android (§3.4) |
| Ticket `MismatchSenderId`                           | `google-services.json` d'un autre projet Firebase que la clé de service |
| Rien sur émulateur                                  | Pas de Google Play Services : tester sur un vrai téléphone              |
| Rien alors que tout est bon                         | Le package Android de Firebase ≠ `com.vora.app` (§3.2)                  |
| Ça marchait, ça ne marche plus après réinstallation | Nouveau jeton ; l'ancien doit être purgé sur `DeviceNotRegistered`      |
| `eas credentials` : les libellés ne correspondent pas au plan | Version d'`eas-cli` différente — suis la ligne qui mentionne **FCM V1**, ou passe par le chemin A (§3.4) |


