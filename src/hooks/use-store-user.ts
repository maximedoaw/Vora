import { useUser } from '@clerk/expo';
import { useConvexAuth, useMutation } from 'convex/react';
import { useCallback, useEffect, useState } from 'react';

import { api } from '../../convex/_generated/api';

export type StoreUserStatus = 'pending' | 'ready' | 'error';

/** Nom affichable dérivé du profil Clerk (SSO Google comme inscription e-mail). */
function displayName(user: ReturnType<typeof useUser>['user']): string {
  return (
    user?.fullName ||
    user?.username ||
    user?.primaryEmailAddress?.emailAddress ||
    'Utilisateur'
  );
}

/**
 * Crée la ligne `users` côté Convex à la première connexion.
 * Filet de sécurité qui rend l'app autonome sans webhook Clerk : `syncUser` est
 * idempotente, elle renvoie l'utilisateur existant le cas échéant.
 */
export function useStoreUser(): { status: StoreUserStatus; retry: () => void } {
  const { isAuthenticated } = useConvexAuth();
  const { user } = useUser();
  const syncUser = useMutation(api.users.syncUser);

  const [status, setStatus] = useState<StoreUserStatus>('pending');
  const [attempt, setAttempt] = useState(0);

  const name = displayName(user);

  useEffect(() => {
    if (!isAuthenticated) {
      setStatus('pending');
      return;
    }

    let active = true;
    void (async () => {
      try {
        await syncUser({ name });
        if (active) setStatus('ready');
      } catch (error) {
        console.error('[convex] syncUser a échoué', error);
        if (active) setStatus('error');
      }
    })();

    return () => {
      active = false;
    };
  }, [attempt, isAuthenticated, name, syncUser]);

  const retry = useCallback(() => {
    setStatus('pending');
    setAttempt((value) => value + 1);
  }, []);

  return { status, retry };
}
