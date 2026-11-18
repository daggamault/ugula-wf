export const SERVICE_LEVELS = ['BLS', 'ALS1', 'ALS2', 'SCT'] as const;

export type ServiceLevel = (typeof SERVICE_LEVELS)[number];

export const CLASSIFICATIONS = [
  'emergency',
  'scheduled',
  'pronouncedDead',
  'treatNoTransport',
  'refusal',
  'notBillable'
] as const;

export type Classification = (typeof CLASSIFICATIONS)[number];

export const CLASSIFICATION_LABELS: Record<Classification, string> = {
  emergency: 'Emergency Transport',
  scheduled: 'Scheduled Transport',
  pronouncedDead: 'Pronounced Dead Before Loading',
  treatNoTransport: 'Treated, Not Transported',
  refusal: 'Refused Care',
  notBillable: 'Not Billable'
};

export const HCPCS_PATTERN = '^[A-Z][0-9]{4}$';

export const UNIT_SCALE = 1;

export type ClaimLine = { code: string; units: number };

export type PricedLine = ClaimLine & { unitCents: number; totalCents: number };
