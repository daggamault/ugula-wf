import { type Address, readAddress } from './patients.ts';
import { recordOf, textOrNull } from './values.ts';

export type Location = Address & { name: string | null };

export type Coverage = {
  payer: string;
  payerId: string | null;
  payerCode: string | null;
  memberId: string | null;
  groupId: string | null;
};

export type ClaimDetails = {
  serviceDate: string | null;
  pickup: Location;
  destination: Location;
  diagnoses: string[];
  originDestination: string | null;
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

const originDestination = (x: unknown) => {
  const code = typeof x === 'string' ? x.trim().toUpperCase() : null;
  return isOriginDestination(code) ? code : null;
};

const PRIORITY_ORDER = [
  '2611003',
  '2611005',
  '2611007',
  '2611009',
  '2611011',
  '2611013',
  '2611015',
  '2611017',
  '2611019',
  '2611021',
  '2611023'
];

const location = (x: unknown): Location => {
  const r = recordOf(x);
  return { name: textOrNull(r.name), ...readAddress(r) };
};

export const ICD10_PATTERN = '^[A-Z][0-9][0-9A-Z]{1,5}$';

const ICD10 = new RegExp(ICD10_PATTERN);

export const icd10 = (x: unknown): string | null => {
  const code = textOrNull(x)?.toUpperCase().replace('.', '');
  return code && ICD10.test(code) ? code : null;
};

const serviceDate = (x: unknown) => {
  const value = textOrNull(x);
  return value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
};

export const readClaimDetails = (claim: unknown): ClaimDetails => {
  const c = recordOf(claim);
  const codes = Array.isArray(c.diagnoses) ? c.diagnoses : [];
  return {
    serviceDate: serviceDate(c.serviceDate),
    pickup: location(c.pickup),
    destination: location(c.destination),
    diagnoses: [...new Set(codes.map(icd10).filter((x) => x !== null))].slice(0, DIAGNOSIS_LIMIT),
    originDestination: originDestination(c.originDestination)
  };
};

const rank = (priority: unknown) => {
  const i = PRIORITY_ORDER.indexOf(String(priority));
  return i < 0 ? PRIORITY_ORDER.length : i;
};

export const readCoverages = (list: unknown): Coverage[] => {
  const rows = (Array.isArray(list) ? list : []).map(recordOf);
  const seen = new Set<string>();
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.priority) - rank(b.r.priority) || a.i - b.i)
    .flatMap(({ r }) => {
      const payer = textOrNull(r.payer);
      if (!payer || seen.has(payer.toLowerCase())) return [];
      seen.add(payer.toLowerCase());
      return [
        {
          payer,
          payerId: textOrNull(r.payerId),
          payerCode: textOrNull(r.payerCode),
          memberId: textOrNull(r.memberId),
          groupId: textOrNull(r.groupId)
        }
      ];
    });
};
