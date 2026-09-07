import { useMutation } from 'convex/react';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { router } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { Platform } from 'react-native';

import {
  ensureChannel,
  ensurePermission,
  getRemoteToken,
  onNotificationOpened,
} from '@/lib/notifications';
import { api } from '../../convex/_generated/api';

/**
 * Jeton de l'appareil, au niveau du module.
 *
 * `usePushToken` n'est monté qu'une fois (dans `AuthedApp`) : sans ce partage,
 * la page compte n'aurait aucun moyen de connaître le jeton à oublier, et la
 * monter une seconde fois dupliquerait les écouteurs de clic — un appui sur une
 * notification déclencherait deux navigations.
 */
let deviceToken: string | null = null;

function projectId(): string | null {
  const fromConfig = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
    ?.eas?.projectId;
  return fromConfig ?? Constants.easConfig?.projectId ?? null;
}

/**
 * Prépare les notifications et ouvre le bon écran au clic.
 *
 * Deux niveaux, indépendants :
 *
 * 1. **Canal Android et permission** — indispensables aux notifications
 *    **locales**, qui ne demandent aucune configuration Firebase. C'est ce qui
 *    fait fonctionner les alertes de course aujourd'hui, Expo Go compris.
 * 2. **Jeton Expo** — pour le push distant uniquement. Impossible sous Expo Go,
 *    et sans clé FCM déposée : on n'insiste pas, l'application reste entière.
 *
 * Monté une seule fois dans `AuthedApp` : une notification peut être touchée
 * application fermée, l'écran de destination n'existe pas encore à ce moment-là.
 */
export function usePushToken() {
  const registerToken = useMutation(api.push.registerToken);

  useEffect(() => {
    let active = true;

    void (async () => {
      await ensureChannel();
      if (!(await ensurePermission())) return;

      // Un émulateur sans Play Services n'obtiendra jamais de jeton distant.
      if (!Device.isDevice) return;

      const id = projectId();
      if (!id) return;

      const token = await getRemoteToken(id);
      if (!token || !active) return;

      deviceToken = token;
      try {
        await registerToken({ token, platform: Platform.OS });
      } catch (error) {
        console.warn('[push] enregistrement du jeton impossible', error);
      }
    })();

    return () => {
      active = false;
    };
  }, [registerToken]);

  useEffect(() => onNotificationOpened((url) => router.push(url as never)), []);
}

/**
 * Callback à jouer avant `signOut` : l'appareil doit cesser de recevoir les
 * notifications du compte qui s'en va.
 */
export function useForgetDevice() {
  const unregisterToken = useMutation(api.push.unregisterToken);

  return useCallback(async () => {
    if (!deviceToken) return;
    try {
      await unregisterToken({ token: deviceToken });
      deviceToken = null;
    } catch (error) {
      console.warn('[push] désinscription impossible', error);
    }
  }, [unregisterToken]);
}
