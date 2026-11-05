export const FACILITY_KINDS = {
  hospital: 'Hospital',
  snf: 'Skilled nursing facility',
  dialysis: 'Dialysis facility',
  other: 'Other facility'
} as const;

export type FacilityKind = keyof typeof FACILITY_KINDS;

export const isFacilityKind = (x: unknown): x is FacilityKind =>
  typeof x === 'string' && Object.hasOwn(FACILITY_KINDS, x);

export const RESPONSIBLE_PARTIES = ['payer', 'facility'] as const;

export type ResponsibleParty = (typeof RESPONSIBLE_PARTIES)[number];

export const isResponsibleParty = (x: unknown): x is ResponsibleParty =>
  RESPONSIBLE_PARTIES.includes(x as ResponsibleParty);

export type CheckedFacility = {
  id: string;
  name: string;
  kind: FacilityKind;
  contract: boolean;
};
