import { money } from './numbers.ts';

export type Placement = {
  claimNumber: string;
  pcrNumber: string | null;
  serviceDate: string | null;
  patient: string;
  birthDate: string | null;
  addressLine: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  balanceCents: number;
  placedOn: string;
  agencyName: string;
  feePct: number;
};

const HEADER = [
  'Claim',
  'PCR Number',
  'Date of Service',
  'Patient',
  'Birth Date',
  'Street Address',
  'City',
  'State',
  'ZIP Code',
  'Balance',
  'Placed On',
  'Collection Agency',
  'Fee (%)'
];

const FORMULA = /^[=+\-@\t\r]/;

const cell = (value: string | number | null) => {
  const raw = value === null ? '' : String(value);
  const text = FORMULA.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

export const placementCsv = (placements: readonly Placement[]) =>
  [
    HEADER,
    ...placements.map((p) => [
      p.claimNumber,
      p.pcrNumber,
      p.serviceDate,
      p.patient,
      p.birthDate,
      p.addressLine,
      p.city,
      p.state,
      p.postalCode,
      money(p.balanceCents),
      p.placedOn,
      p.agencyName,
      p.feePct
    ])
  ]
    .map((row) => row.map(cell).join(','))
    .join('\r\n')
    .concat('\r\n');
