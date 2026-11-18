export const FACILITY_KINDS = {
  hospital: 'Hospital',
  snf: 'Skilled nursing facility',
  dialysis: 'Dialysis facility',
  other: 'Other facility'
} as const;

export type FacilityKind = keyof typeof FACILITY_KINDS;

export const isFacilityKind = (x: unknown): x is FacilityKind =>
  typeof x === 'string' && Object.hasOwn(FACILITY_KINDS, x);

export const CCN_PATTERN = '^[0-9A-Z]{6}$';

export type Hospital = {
  ccn: string;
  name: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  phone: string | null;
  hospitalType: string;
  emergencyServices: boolean;
  similarity: number;
};
