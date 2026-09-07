import { useQuery } from 'convex/react';
import { useEffect, useRef } from 'react';

import { notifyLocally } from '@/lib/notifications';
import { formatXaf } from '@/lib/vehicles';
import { api } from '../../convex/_generated/api';

/**
 * Alertes de course **sans aucune configuration**.
 *
 * Convex pousse les changements en temps réel jusqu'à l'application ; il suffit
 * de comparer l'état d'un rendu au précédent pour savoir qu'il s'est passé
 * quelque chose, et d'afficher une notification **locale** — celles-là ne
 * passent ni par Firebase ni par le service Expo, le téléphone les fabrique.
 *
 * ⚠️ Limite assumée : ça ne marche que si l'application tourne (au premier plan
 * ou récemment mise en arrière-plan). Application fermée par l'utilisateur ou
 * tuée par Android, rien n'arrive — seul un vrai push distant le permettrait.
 *
 * Le serveur envoie **en plus** ses notifications push (`convex/push.ts`) : le
 * jour où la clé FCM est déposée, les deux canaux se complètent. Un doublon
 * ponctuel vaut mieux qu'une alerte manquée.
 */
export function useRideAlerts() {
  const state = useQuery(api.rides.alertState, {});

  /** Ce qu'on a déjà annoncé — évite de rejouer la même alerte à chaque rendu. */
  const announced = useRef(new Set<string>());
  const knownStatus = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!state) return;

    const once = (key: string, title: string, body: string) => {
      if (announced.current.has(key)) return;
      announced.current.add(key);
      void notifyLocally(title, body);
    };

    const ride = state.ride;
    if (ride) {
      const previous = knownStatus.current[ride.id];
      knownStatus.current[ride.id] = ride.status;

      // Premier rendu : on enregistre l'état sans rien annoncer, sinon ouvrir
      // l'app suffirait à déclencher une notification pour du déjà-vu.
      if (previous && previous !== ride.status) {
        if (ride.status === 'matched' && !ride.asDriver) {
          once(`${ride.id}:matched`, 'Course acceptée', `${ride.counterpart} arrive vers toi.`);
        }

        if (ride.status === 'completed') {
          const amount = ride.paidAmount != null ? formatXaf(ride.paidAmount) : null;
          once(
            `${ride.id}:completed`,
            'Course terminée',
            ride.asDriver
              ? amount
                ? `${amount} reçus de ${ride.counterpart}.`
                : `Course avec ${ride.counterpart} terminée.`
              : amount
                ? `${amount} réglés à ${ride.counterpart}. Note ta course.`
                : `Course avec ${ride.counterpart} terminée. Note ta course.`,
          );
        }

        if (ride.status === 'cancelled') {
          once(`${ride.id}:cancelled`, 'Course annulée', `La course avec ${ride.counterpart} est annulée.`);
        }
      }

      // Posé une seule fois côté serveur : on s'en sert tel quel comme signal.
      if (ride.nearNotifiedAt && !ride.asDriver) {
        once(
          `${ride.id}:near`,
          'Ton chauffeur arrive',
          `${ride.counterpart} est à moins de 200 m.`,
        );
      }
    }

    for (const request of state.pending) {
      once(
        `${request.id}:requested`,
        'Nouvelle demande de course',
        `${request.riderName} attend une réponse.`,
      );
    }
  }, [state]);
}
