import type { Documentation } from './documentation.ts';
import type { Address } from './patients.ts';

export type Location = Address & { name: string | null };

export const SELF = '18';

export const INSURED_RELATIONSHIPS = [
  SELF,
  '01',
  '19',
  '20',
  '21',
  '39',
  '40',
  '53',
  'G8'
] as const;

export type InsuredRelationship = (typeof INSURED_RELATIONSHIPS)[number];

export const RELATIONSHIP_LABELS: Record<InsuredRelationship, string> = {
  [SELF]: 'Self',
  '01': 'Spouse',
  '19': 'Child',
  '20': 'Employee',
  '21': 'Unknown',
  '39': 'Organ donor',
  '40': 'Cadaver donor',
  '53': 'Life partner',
  G8: 'Other relationship'
};

export type Coverage = {
  payer: string;
  payerId: string | null;
  payerCode: string | null;
  memberId: string | null;
  groupId: string | null;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
};

export type ClaimDetails = {
  serviceDate: string | null;
  pickup: Location;
  destination: Location;
  diagnoses: string[];
  originDestination: string | null;
  documentation: Documentation;
};

export const DIAGNOSIS_LIMIT = 12;

export const ORIGIN_DESTINATION_CODES: Readonly<Record<string, string>> = {
  R: 'Residence',
  S: 'Scene of an accident or acute event',
  H: 'Hospital',
  N: 'Skilled nursing facility',
  E: 'Residential or custodial facility',
  P: "Physician's office",
  D: 'Diagnostic or therapeutic site',
  G: 'Hospital-based dialysis facility',
  J: 'Freestanding dialysis facility',
  I: 'Transfer site between ambulances',
  X: "Stop at a physician's office on the way to a hospital"
};

const DESTINATION_ONLY = 'X';

export const isOriginDestination = (x: unknown): x is string =>
  typeof x === 'string' &&
  x.length === 2 &&
  x[0] !== DESTINATION_ONLY &&
  [...x].every((c) => Object.hasOwn(ORIGIN_DESTINATION_CODES, c));

export const ICD10_PATTERN = '^[A-Z][0-9][0-9A-Z]{1,5}$';
