/**
 * Types de véhicule et grille tarifaire — Yaoundé, FCFA (XAF).
 * Même source que Yarto (tarifs publics Yango Yaoundé).
 */

export type VehicleTypeId = 'moto' | 'berline' | 'suv' | 'van' | 'other';

export type Tariff = {
  minFare: number;
  perKm: number;
  perMin: number;
  freeWaitMin: number;
  perWaitMin: number;
};

export type VehicleType = {
  id: VehicleTypeId;
  label: string;
  tariffClass: string;
  description: string;
  seats: number;
  tariff: Tariff;
  derived: boolean;
};

const ECO_TARIFF: Tariff = {
  minFare: 450,
  perKm: 88,
  perMin: 25,
  freeWaitMin: 5,
  perWaitMin: 27,
};

export const VEHICLE_TYPES: readonly VehicleType[] = [
  {
    id: 'moto',
    label: 'Moto-taxi',
    tariffClass: 'Moto',
    description: 'Le plus rapide dans les embouteillages',
    seats: 1,
    tariff: {
      minFare: 300,
      perKm: 55,
      perMin: 15,
      freeWaitMin: 5,
      perWaitMin: 16,
    },
    derived: true,
  },
  {
    id: 'berline',
    label: 'Berline',
    tariffClass: 'Éco',
    description: 'Confort standard, 4 places',
    seats: 4,
    tariff: ECO_TARIFF,
    derived: false,
  },
  {
    id: 'suv',
    label: 'SUV',
    tariffClass: 'Confort',
    description: 'Routes difficiles, plus d\'espace',
    seats: 4,
    tariff: {
      minFare: 600,
      perKm: 120,
      perMin: 34,
      freeWaitMin: 5,
      perWaitMin: 36,
    },
    derived: true,
  },
  {
    id: 'van',
    label: 'Van',
    tariffClass: 'Confort+',
    description: 'Groupes et bagages volumineux',
    seats: 7,
    tariff: {
      minFare: 800,
      perKm: 150,
      perMin: 43,
      freeWaitMin: 5,
      perWaitMin: 46,
    },
    derived: true,
  },
] as const;

export const OTHER_VEHICLE_TYPE: VehicleType = {
  id: 'other',
  label: 'Autre',
  tariffClass: 'Éco',
  description: 'Véhicule renseigné par le chauffeur',
  seats: 4,
  tariff: ECO_TARIFF,
  derived: false,
};

export function resolveVehicleType(label: string): VehicleType {
  const normalized = label.trim().toLowerCase();
  return (
    VEHICLE_TYPES.find((v) => v.label.toLowerCase() === normalized) ?? {
      ...OTHER_VEHICLE_TYPE,
      label: label.trim() || OTHER_VEHICLE_TYPE.label,
    }
  );
}

const roundFare = (amount: number) => Math.ceil(amount / 25) * 25;

export function estimateFare(
  type: VehicleType,
  distanceKm: number,
  durationMin: number,
  waitMin = 0,
): number {
  const { minFare, perKm, perMin, freeWaitMin, perWaitMin } = type.tariff;
  const waiting = Math.max(0, waitMin - freeWaitMin) * perWaitMin;
  const raw = perKm * distanceKm + perMin * durationMin + waiting;
  return Math.max(minFare, roundFare(raw));
}

const xafFormatter = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function formatXaf(amount: number): string {
  return `${xafFormatter.format(amount)} FCFA`;
}
