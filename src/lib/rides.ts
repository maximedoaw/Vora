import type { VoraPalette } from '@/constants/theme';

export type RideStatus = 'requested' | 'matched' | 'in_progress' | 'completed' | 'cancelled';

const LABELS: Record<RideStatus, string> = {
  requested: 'En attente',
  matched: 'Acceptée',
  in_progress: 'En cours',
  completed: 'Terminée',
  cancelled: 'Annulée',
};

/** Libellé côté passager quand la nuance compte (le chauffeur est en route). */
const RIDER_LABELS: Partial<Record<RideStatus, string>> = {
  matched: 'Chauffeur en route',
};

export function rideStatusLabel(status: RideStatus, asDriver = false): string {
  return (!asDriver && RIDER_LABELS[status]) || LABELS[status];
}

/** Une course close ne bouge plus : ni suivi, ni action. */
export function isRideActive(status: RideStatus): boolean {
  return status === 'requested' || status === 'matched' || status === 'in_progress';
}

/** Couleur de la pastille de statut, prise dans la palette du thème courant. */
export function rideStatusColor(status: RideStatus, c: VoraPalette): string {
  switch (status) {
    case 'completed':
    case 'in_progress':
    case 'matched':
      return c.accent;
    case 'cancelled':
      return c.danger;
    default:
      return c.warning;
  }
}

export function rideStatusTint(status: RideStatus, c: VoraPalette): string {
  switch (status) {
    case 'completed':
    case 'in_progress':
    case 'matched':
      return c.accentSoft;
    case 'cancelled':
      return c.dangerBg;
    default:
      return c.warningBg;
  }
}
