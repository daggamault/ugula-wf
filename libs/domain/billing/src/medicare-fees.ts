export const RURALITIES = ['urban', 'rural', 'superRural'] as const;

export type Rurality = (typeof RURALITIES)[number];

export const isRurality = (x: unknown): x is Rurality => RURALITIES.includes(x as Rurality);

export const CARRIER_PATTERN = '^[0-9]{5}$';

export const LOCALITY_PATTERN = '^[0-9]{2}$';

export type MedicareLocality = {
  carrier: string;
  locality: string;
  rurality: Rurality;
  plusFourNeeded: boolean;
};

export type MedicareFee = {
  code: string;
  urbanCents: number;
  ruralCents: number;
  superRuralCents: number | null;
  ruralShortTripCents: number | null;
};
