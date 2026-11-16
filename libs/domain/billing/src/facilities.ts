export const FACILITY_KINDS = {
  hospital: 'Hospital',
  snf: 'Skilled nursing facility',
  dialysis: 'Dialysis facility',
  other: 'Other facility'
} as const;

export type FacilityKind = keyof typeof FACILITY_KINDS;

export const isFacilityKind = (x: unknown): x is FacilityKind =>
  typeof x === 'string' && Object.hasOwn(FACILITY_KINDS, x);

const RESPONSIBLE_PARTIES = ['payer', 'facility'] as const;

export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

export const isResponsibleParty = (x: unknown): x is ResponsibleParty =>
  RESPONSIBLE_PARTIES.includes(x as ResponsibleParty);

export type CheckedFacility = {
  id: string;
  name: string;
  kind: FacilityKind;
  contract: boolean;
};

export const CCN_PATTERN = '^[0-9A-Z]{6}$';

export const HOSPITAL_WORD_SIMILARITY = 0.6;

export const HOSPITAL_NAME_SIMILARITY = 0.3;

const HOSPITAL_TIE = 0.1;

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

export const pickHospital = (candidates: readonly Hospital[], postalCode: string | null) => {
  const [top] = candidates;
  if (!top) return null;
  const tied = candidates.filter((h) => top.similarity - h.similarity < HOSPITAL_TIE);
  if (tied.length === 1) return top;
  const inZip = tied.filter((h) => h.postalCode === postalCode);
  return inZip.length === 1 ? (inZip[0] ?? null) : null;
};
