import { isRunningInExpoGo } from 'expo';
import { Platform } from 'react-native';

/**
 * Accès protégé à `expo-notifications`.
 *
 * **Le module entier est inutilisable sous Expo Go sur Android.** Ce n'est pas
 * seulement le push distant : `expo-notifications/build/index.js` réexporte
 * `DevicePushTokenAutoRegistration.fx`, qui appelle `addPushTokenListener()`
 * **au niveau module**. Cette fonction appelle `warnOfExpoGoPushUsage()`, qui
 * fait un `throw` — pas un simple avertissement — sur Android sous Expo Go.
 *
 * Autrement dit, le seul fait de charger la librairie fait tomber
 * l'application. Un `try`/`catch` autour du `require` ne suffit pas : la partie
 * asynchrone du fichier (`.then(...)`) échoue après coup, hors de toute portée
 * de capture. La seule parade est de **ne jamais le charger** dans cet
 * environnement, d'où le garde en tête de `api()`.
 *
 * Conséquence : sous Expo Go, aucune notification, même locale. Il faut un
 * build de développement (`npx expo run:android`) — mais **aucune
 * configuration Firebase** n'est nécessaire pour les notifications locales.
 */
type NotificationsModule = typeof import('expo-notifications');

let cached: NotificationsModule | null | undefined;

let toldAboutExpoGo = false;

function api(): NotificationsModule | null {
  if (cached !== undefined) return cached;

  // Voir le commentaire d'en-tête : charger le module ferait tomber l'app.
  if (isRunningInExpoGo()) {
    if (!toldAboutExpoGo) {
      toldAboutExpoGo = true;
      console.log(
        '[notifications] désactivées sous Expo Go — lance `npx expo run:android` ' +
          'pour les activer (aucune configuration Firebase requise).',
      );
    }
    cached = null;
    return null;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('expo-notifications') as NotificationsModule;
  } catch (error) {
    console.warn('[notifications] module indisponible', error);
    cached = null;
  }
  return cached;
}

/**
 * `false` sous Expo Go, et tant qu'aucune clé FCM n'est déposée chez Expo.
 * Le premier cas est détectable ici, le second seulement à l'usage.
 */
export function remotePushSupported(): boolean {
  return !isRunningInExpoGo();
}

/** `false` sous Expo Go : la librairie ne peut même pas y être chargée. */
export function localNotificationsSupported(): boolean {
  return api() !== null;
}

let handlerReady = false;

/**
 * Comportement à l'arrivée d'une notification **application ouverte**.
 * Posé à la demande plutôt qu'au chargement du module : rien ne doit s'exécuter
 * pendant l'évaluation du graphe de modules.
 */
function ensureHandler() {
  const notifications = api();
  if (!notifications || handlerReady) return;
  handlerReady = true;
  notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

/** Depuis Android 8, une notification sans canal n'est jamais affichée. */
export async function ensureChannel() {
  const notifications = api();
  if (!notifications) return;
  ensureHandler();
  if (Platform.OS !== 'android') return;

  try {
    await notifications.setNotificationChannelAsync('default', {
      name: 'Courses',
      importance: notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#1ED760',
    });
  } catch (error) {
    console.warn('[notifications] canal Android impossible', error);
  }
}

/** Demande la permission si elle n'a jamais été refusée. */
export async function ensurePermission(): Promise<boolean> {
  const notifications = api();
  if (!notifications) return false;

  try {
    const current = await notifications.getPermissionsAsync();
    if (current.granted) return true;
    if (!current.canAskAgain) return false;
    return (await notifications.requestPermissionsAsync()).granted;
  } catch (error) {
    console.warn('[notifications] permission impossible', error);
    return false;
  }
}

/**
 * Bannière affichée par le téléphone lui-même.
 * Aucun serveur, aucun Firebase — mais un build de développement est requis
 * (voir le commentaire d'en-tête), sans quoi l'appel est simplement ignoré.
 */
export async function notifyLocally(title: string, body: string, url?: string) {
  const notifications = api();
  if (!notifications) return;

  try {
    await ensureChannel();
    const { granted } = await notifications.getPermissionsAsync();
    if (!granted) return;

    await notifications.scheduleNotificationAsync({
      content: { title, body, sound: 'default', data: url ? { url } : {} },
      trigger: null,
    });
  } catch (error) {
    console.warn('[notifications] notification locale impossible', error);
  }
}

/**
 * Jeton de push distant, ou `null` si indisponible.
 * Sous Expo Go on ne tente même pas l'appel : il lèverait une exception.
 */
export async function getRemoteToken(projectId: string): Promise<string | null> {
  const notifications = api();
  if (!notifications || !remotePushSupported()) return null;

  try {
    const { data } = await notifications.getExpoPushTokenAsync({ projectId });
    return data;
  } catch (error) {
    console.log('[notifications] push distant indisponible', (error as Error).message);
    return null;
  }
}

type ResponseHandler = (url: string) => void;

/** Chemin porté par une notification touchée, s'il est exploitable. */
function urlOf(response: unknown): string | null {
  const data = (response as { notification?: { request?: { content?: { data?: unknown } } } })
    ?.notification?.request?.content?.data as { url?: unknown } | undefined;
  return typeof data?.url === 'string' && data.url.startsWith('/') ? data.url : null;
}

/**
 * Écoute les appuis sur les notifications, y compris celui qui a réveillé
 * l'application. Renvoie de quoi se désabonner.
 */
export function onNotificationOpened(handle: ResponseHandler): () => void {
  const notifications = api();
  if (!notifications) return () => {};

  void notifications
    .getLastNotificationResponseAsync()
    .then((response) => {
      const url = urlOf(response);
      if (url) handle(url);
    })
    .catch(() => {
      /* démarrage sans notification : rien à faire */
    });

  const subscription = notifications.addNotificationResponseReceivedListener((response) => {
    const url = urlOf(response);
    if (url) handle(url);
  });

  return () => subscription.remove();
}
