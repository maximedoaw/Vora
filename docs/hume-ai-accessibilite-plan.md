# Plan — Hume AI dans Vora : accessibilité et innovations vocales

Document de travail. Basé sur la documentation officielle de Hume
([dev.hume.ai](https://dev.hume.ai)) et sur le dépôt d'exemples
[HumeAI/hume-api-examples](https://github.com/HumeAI/hume-api-examples).

---

## 0. À lire avant tout : ce que Hume apporte, et ce qu'il n'apporte pas

Avant d'écrire une ligne, il faut être clair sur un point, sinon on va dépenser
de l'argent et du temps pour rien.

**Android a déjà un lecteur d'écran : TalkBack.** Un utilisateur aveugle
l'utilise pour *toutes* ses applications. Il lit les libellés, annonce les
boutons, décrit la navigation. Il est gratuit, il fonctionne hors ligne, il ne
consomme aucun quota, et il est déjà installé sur le téléphone.

Vora est **partiellement prêt** pour lui : j'ai compté **25 `accessibilityLabel`
dans 12 fichiers**. C'est un bon début, mais il reste des trous béants — la
carte, les marqueurs de chauffeur, la liste des courses.

| | Coût | Hors ligne | Ce que ça résout |
|---|---|---|---|
| **TalkBack + labels** | 0 € | ✅ | Lire l'écran, naviguer |
| **`expo-speech`** | 0 € | ✅ | Annoncer un événement à voix haute |
| **Hume Octave TTS** | ~0,05–0,15 €/1000 car. | ❌ | Voix **expressive**, ton adapté au message |
| **Hume EVI** | ~0,04–0,07 €/min | ❌ | **Converser** : commander une course à la voix |

👉 **La règle que je propose** : d'abord finir les `accessibilityLabel` et
ajouter `expo-speech` — c'est gratuit et ça débloque 80 % de l'usage. **Ensuite**
Hume, pour ce que rien d'autre ne sait faire : la **conversation** et
l'**émotion**.

Ce document couvre les deux, dans cet ordre.

---

## 1. Ce qu'est Hume AI, concrètement

Trois produits, dont deux nous intéressent.

### EVI — Empathic Voice Interface

Une IA vocale **temps réel** : on lui parle, elle répond en parlant. Elle
analyse le ton, le rythme et le timbre de la voix pour adapter sa réponse.

- Deux versions : **EVI 3** (anglais seulement) et **EVI 4-mini** (11 langues,
  nécessite un LLM d'appoint). ⚠️ **Le français passe par EVI 4-mini.**
- Connexion par **WebSocket**. On envoie des messages `audio_input`, on reçoit
  `user_message` (transcription + analyse vocale), `assistant_message`,
  `audio_output` et `assistant_end`.
- Sait appeler des **fonctions** de notre code (voir §4) : c'est ce qui permet
  de dire « emmène-moi à Bastos » et que la destination soit réellement posée.

### Octave TTS — synthèse vocale expressive

Un modèle de synthèse qui « comprend le texte qu'il prononce, émotionnellement
et sémantiquement ». Il adapte prononciation, hauteur, tempo et emphase.

- Latence annoncée ~100 ms, sortie **MP3, WAV ou PCM**.
- Endpoints : `/v0/tts` (synchrone), `/v0/tts/stream/json` et
  `/v0/tts/stream/file` (streaming HTTP), `/v0/tts/stream/input` (WebSocket).
- Limites : **5 000 caractères** par énoncé, 1 000 pour la description de voix.
- **Voice Design** : on décrit une voix en langage naturel (« une voix calme et
  rassurante de conductrice expérimentée ») et le modèle la fabrique.

### Expression Measurement — hors périmètre

Mesure d'émotions sur le visage, la voix ou le texte. Intéressant pour la
sécurité (détecter la détresse d'un passager), mais ça soulève des questions de
consentement et de vie privée qu'on ne réglera pas en passant. **Écarté ici.**

---

## 2. Le mur technique : Hume et React Native

C'est le point qui va décider du calendrier, autant le savoir tout de suite.

**Le SDK React officiel de Hume (`@humeai/voice-react`) ne fonctionne pas en
React Native.** Il s'appuie sur des API navigateur (`MediaRecorder`,
`AudioContext`) qui n'existent pas ici.

Hume fournit un exemple React Native officiel
([`evi/evi-react-native`](https://github.com/HumeAI/hume-api-examples/tree/main/evi/evi-react-native)),
et son README dit exactement pourquoi c'est compliqué :

> « Les librairies communautaires comme `expo-av` ne supportent pas
> l'enregistrement audio en streaming ni l'annulation d'écho […] il est
> nécessaire d'écrire du code natif pour interfacer le micro et le haut-parleur. »

L'exemple embarque donc un module `modules/audio` **écrit en Swift (iOS) et en
Kotlin (Android)**.

### Ce que ça implique pour Vora

| Fonctionnalité | Faisabilité | Pourquoi |
|---|---|---|
| **Octave TTS** (Vora parle) | ✅ Facile | Un `fetch`, un fichier audio, `expo-audio` le joue. Pas de streaming micro. |
| **EVI** (conversation) | ⚠️ Lourd | Capture micro en streaming + annulation d'écho → module natif à intégrer. |

**Conséquence sur l'ordre des travaux** : Octave TTS d'abord (§5), EVI ensuite
(§6). La première apporte déjà énormément à un utilisateur aveugle, pour une
fraction de l'effort.

⚠️ Autre contrainte : `expo-notifications` nous a déjà appris qu'**Expo Go ne
suffit pas** dès qu'il y a du natif. Tout ce document suppose
`npx expo run:android`.

---

## 3. Authentification — à faire correctement dès le début

Hume donne **deux clés** : une `API key` et une `Secret key`.

La documentation est explicite sur l'usage client :

> « Pour faire des requêtes en toute sécurité depuis une application cliente,
> obtenez d'abord un jeton d'accès temporaire en échangeant vos identifiants
> côté serveur […] pour éviter d'exposer la clé API au client. »

### Le circuit à mettre en place

```
   App Vora                    Convex (action)              Hume
   ────────                    ───────────────              ────
1. demande un jeton  ────────►
                               base64(apiKey:secretKey)
                               POST /oauth2-cc/token  ────►
                               ◄──── access_token (30 min)
   ◄──── access_token
2. WebSocket / REST  ─────────────────────────────────────►
      Authorization: Bearer <token>
```

**Les deux clés vivent dans les variables d'environnement Convex**, jamais dans
le bundle :

```sh
npx convex env set HUME_API_KEY <clé>
npx convex env set HUME_SECRET_KEY <secret>
```

Nouvelle action `convex/hume.ts` → `getAccessToken` : elle échange les clés
contre un jeton valable **30 minutes** et le renvoie à l'app. Prévoir un
renouvellement : une course peut durer plus longtemps.

> ⚠️ L'exemple React Native de Hume met `EXPO_PUBLIC_HUME_API_KEY` dans un
> `.env` — son README précise que c'est **pour le développement uniquement**.
> On ne reproduit pas ça : la clé finirait dans l'APK, lisible par n'importe qui.

---

## 4. Les cas d'usage, du plus utile au plus ambitieux

### 4.1 🦯 Annonces vocales pour utilisateur aveugle — *le cœur du sujet*

Vora est une application **de carte**. Or une carte est le pire support pour un
non-voyant : TalkBack ne sait pas lire un tracé. Tout ce qui compte doit donc
être dit **en mots**.

Les moments à sonoriser, dans l'ordre d'importance :

| Moment | Ce que la voix doit dire |
|---|---|
| Destination choisie | « Bastos, à 4,2 kilomètres. Course estimée à 1 250 francs. » |
| Chauffeur suggéré | « Awono Serge, berline, à 600 mètres, noté 4,9 sur 5. » |
| Course acceptée | « Awono Serge a accepté. Il arrive dans 6 minutes. » |
| **Approche** | « Ton chauffeur est à 200 mètres. Plaque CE 204 AB, berline blanche. » |
| Départ / arrivée | « Course démarrée. » / « Arrivé à destination. » |
| Paiement | « 1 250 francs à régler. Double-tape pour Orange Money. » |

**Le point d'accroche existe déjà** : `src/hooks/use-ride-alerts.ts` détecte
déjà tous ces changements d'état pour les notifications. Il suffit d'y ajouter
un appel vocal à côté de `notifyLocally`.

**Étape 1 — gratuite (`expo-speech`).** À faire en premier, ça marche hors
ligne et sans quota.

**Étape 2 — Octave TTS.** La même chose, mais avec une voix qui a le ton juste :
posée pour une confirmation, plus pressante pour « ton chauffeur est là ». C'est
là que Hume se distingue d'un TTS ordinaire.

### 4.2 🎙️ Commander une course à la voix (EVI)

Un bouton « Parler à Vora », maintenu ou activé par un double-tap. L'utilisateur
dit : « Je veux aller au marché Mokolo ». EVI comprend, appelle nos fonctions,
et la course se prépare sans qu'aucun écran ne soit touché.

C'est ici qu'intervient le **tool use** de Hume. Le flux documenté :

1. L'utilisateur pose sa question ;
2. EVI émet un message **`tool_call`** avec les paramètres extraits ;
3. Notre code exécute la fonction ;
4. On renvoie **`tool_response`** (ou `tool_error` en cas d'échec) ;
5. EVI formule une réponse parlée à partir du résultat.

Les outils à déclarer dans la configuration EVI (nom en minuscules, description,
paramètres en JSON Schema) :

| Outil | Paramètres | Ce qu'il fait dans Vora |
|---|---|---|
| `chercher_lieu` | `query` | `geocode()` → propose les résultats à voix haute |
| `definir_destination` | `lat`, `lng`, `nom` | `users.setDestination` |
| `lister_chauffeurs` | — | `drivers.listSuggested` |
| `demander_course` | `driverKey` | ouvre le fil + `chat.shareLocation` |
| `etat_course` | — | `rides.alertState` |
| `annuler_course` | — | `rides.cancel` |

⚠️ La configuration doit pointer un **modèle de langage qui supporte le tool
use** — la doc cite Claude, GPT, Gemini et Moonshot.

⚠️ **En français, il faut EVI 4-mini** (EVI 3 est anglais uniquement).

### 4.3 🚨 Détection de détresse pendant une course

EVI renvoie, dans chaque `user_message`, une **analyse de l'expression vocale**
en plus de la transcription. Une peur ou une panique marquée pourrait déclencher
la table `alerts` déjà présente dans le schéma.

**Je le signale, je ne le recommande pas encore.** Écouter en continu un
passager pose des questions de consentement, de vie privée et de faux positifs
qu'on ne réglera pas en marge d'une autre fonctionnalité. À traiter comme un
projet à part entière, avec un consentement explicite et révocable.

### 4.4 🌍 Franchir la barrière de la langue

EVI 4-mini couvre 11 langues. Un passager anglophone, un chauffeur
francophone : la traduction vocale du fil de discussion devient possible.
Séduisant, mais très en aval — noté pour mémoire.

---

## 5. Phase 1 — La voix qui annonce (2 à 3 jours)

### 5.1 Socle gratuit

```sh
npx expo install expo-speech expo-audio
```

Nouveau `src/lib/voice.ts` :

```ts
export async function announce(text: string) { /* expo-speech, langue fr-FR */ }
```

Branché dans `use-ride-alerts.ts`, à côté de chaque `notifyLocally`.

**Réglage indispensable** dans la page compte : un interrupteur « Annonces
vocales ». Une voix qui parle sans qu'on l'ait demandé est une nuisance, pas une
aide — et un utilisateur de TalkBack aura déjà une voix qui lit l'écran.

**À faire en même temps** : compléter les `accessibilityLabel` manquants. La
carte, les marqueurs de chauffeur et la liste des courses n'en ont pas.

### 5.2 Passage à Octave TTS

Action Convex `hume.speak({ text, description })` :

```ts
POST https://api.hume.ai/v0/tts/file
headers: { "X-Hume-Api-Key": process.env.HUME_API_KEY }
body: {
  utterances: [{
    text,
    description: "Voix féminine camerounaise, calme et rassurante, débit posé"
  }],
  format: { type: "mp3" }
}
```

Le fichier audio est joué par `expo-audio`.

**Trois précautions de conception** :

1. **Mettre en cache.** « Course acceptée » ne change jamais : on le synthétise
   une fois et on rejoue le fichier. Sans cache, le quota part en fumée sur des
   phrases répétées.
2. **Toujours prévoir le repli.** Réseau coupé, quota épuisé, erreur Hume →
   `expo-speech` prend le relais. Une annonce muette est pire qu'une voix
   robotique.
3. **Découper à 5 000 caractères.** C'est la limite par énoncé.

---

## 6. Phase 2 — La conversation (1 à 2 semaines)

Le gros morceau. À n'entamer que si la phase 1 est adoptée par de vrais
utilisateurs.

1. **Partir de l'exemple officiel.** Cloner
   `hume-api-examples/evi/evi-react-native` et le faire tourner tel quel, avant
   de toucher à Vora. C'est le seul moyen de valider la chaîne audio native sur
   ton téléphone.
2. **Récupérer le module natif.** Le dossier `modules/audio` (Swift + Kotlin)
   est ce qui rend la chose possible : streaming micro et annulation d'écho.
   Le porter dans Vora, ou l'utiliser comme référence.
3. **Créer la configuration EVI** dans le portail Hume : modèle compatible tool
   use, langue française (EVI 4-mini), voix, prompt système décrivant Vora.
4. **Déclarer les outils** du §4.2 et les rattacher à la configuration.
5. **Câbler le WebSocket** avec le jeton du §3 :
   - `session_settings` d'abord : **format PCM linéaire 16 bits, 44 100 Hz,
     1 canal** (valeurs recommandées par la doc) ;
   - `audio_input` avec l'audio **encodé en base64**, par tranches de ~100 ms ;
   - `audio_output` reçu en **WAV encodé en base64**, à décoder avant lecture.
6. **Gérer les `tool_call`** en appelant les mutations Convex correspondantes.

⚠️ **Tester avec des écouteurs.** Le README de Hume prévient : sans annulation
d'écho correcte (émulateurs notamment), EVI s'entend parler et se coupe la
parole toute seule.

---

## 7. Ce que ça coûte

Tarifs publics Hume, [hume.ai/pricing](https://www.hume.ai/pricing) :

| Plan | Prix | Caractères TTS | Minutes EVI |
|---|---|---|---|
| Free | 0 € | 10 000 (~10 min) | 5 |
| Starter | 3 $/mois | 30 000 | 40 |
| Creator | 14 $/mois | 140 000 | 200 |
| Pro | 70 $/mois | 1 000 000 | 1 200 |

Au-delà : TTS de 0,15 $ à 0,05 $ / 1 000 caractères, EVI de 0,07 $ à
0,04 $ / minute selon le palier.

⚠️ **Le plan gratuit interdit l'usage commercial.** Il faut au minimum Starter
dès que Vora sert de vrais passagers.

**Ordre de grandeur** : une course sonorisée ≈ 6 annonces × ~80 caractères
≈ **500 caractères**. Le plan Creator (140 000) tient donc environ
**280 courses par mois**. Une conversation EVI d'une minute par course, en
revanche, épuise les 200 minutes en **200 courses** — EVI coûte nettement plus
cher que TTS, d'où l'intérêt de ne l'activer qu'à la demande, jamais en fond.

---

## 8. Ordre d'implémentation

| # | Étape | Effort | Dépend de |
|---|---|---|---|
| 1 | Compléter les `accessibilityLabel` (carte, chauffeurs, courses) | 1 j | — |
| 2 | `expo-speech` + interrupteur « Annonces vocales » | 1 j | — |
| 3 | Brancher les annonces sur `use-ride-alerts.ts` | 0,5 j | 2 |
| 4 | Compte Hume + clés dans Convex + `getAccessToken` | 0,5 j | — |
| 5 | Octave TTS avec cache et repli `expo-speech` | 1,5 j | 4 |
| 6 | **Test avec un utilisateur non-voyant** | — | 1–5 |
| 7 | Exemple EVI React Native en autonome | 2 j | 4 |
| 8 | Module audio natif porté dans Vora | 3 j | 7 |
| 9 | Config EVI + outils + WebSocket | 4 j | 8 |

**L'étape 6 n'est pas optionnelle.** Tout ce document repose sur mes hypothèses
sur l'usage réel d'une application de VTC sans la vue. Une heure avec une
personne concernée en apprendra davantage que trois jours de code.

---

## 9. Sources

- [EVI — vue d'ensemble](https://dev.hume.ai/docs/speech-to-speech-evi/overview)
- [EVI — formats audio](https://dev.hume.ai/docs/speech-to-speech-evi/guides/audio)
- [EVI — tool use](https://dev.hume.ai/docs/speech-to-speech-evi/features/tool-use)
- [Octave TTS — vue d'ensemble](https://dev.hume.ai/docs/text-to-speech-tts/overview)
- [Authentification](https://dev.hume.ai/docs/introduction/api-key)
- [Exemple React Native officiel](https://github.com/HumeAI/hume-api-examples/tree/main/evi/evi-react-native)
- [Tarifs](https://www.hume.ai/pricing)
