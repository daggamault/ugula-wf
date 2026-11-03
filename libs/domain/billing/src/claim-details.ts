import { type Documentation, readDocumentation } from './documentation.ts';
import { type Address, readAddress } from './patients.ts';
import { recordOf, textOrNull } from './values.ts';

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

export const isRelationship = (x: unknown): x is InsuredRelationship =>
  INSURED_RELATIONSHIPS.includes(x as InsuredRelationship);

const NEMSIS_RELATIONSHIPS = new Map<string, InsuredRelationship>([
  ['2622001', SELF],
  ['2622003', '01'],
  ['2622005', '19'],
  ['2622009', '40'],
  ['2622011', '20'],
  ['2622013', '53'],
  ['2622015', '39'],
  ['2622017', '21'],
  ['2622019', 'G8']
]);

const UNKNOWN_RELATIONSHIP = '21';

export const relationshipOf = (x: unknown): InsuredRelationship => {
  const code = textOrNull(x)?.toUpperCase();
  if (!code) return SELF;
  return isRelationship(code) ? code : (NEMSIS_RELATIONSHIPS.get(code) ?? UNKNOWN_RELATIONSHIP);
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

const icd10 = (x: unknown): string | null => {
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
    originDestination: originDestination(c.originDestination),
    documentation: readDocumentation(c.documentation)
  };
};

const rank = (priority: unknown) => {
  const i = PRIORITY_ORDER.indexOf(String(priority));
  return i < 0 ? PRIORITY_ORDER.length : i;
};

const payerNameOf = (r: Record<string, unknown>) => {
  const memberId = textOrNull(r.memberId);
  return (
    textOrNull(r.payer) ??
    textOrNull(r.payerCode) ??
    (memberId ? `Unnamed insurance, member ${memberId}` : null)
  );
};

export const coverageKey = (payer: string, memberId: string | null) =>
  `${payer.trim().toLowerCase()}|${memberId?.trim().toLowerCase() ?? ''}`;

export const readCoverages = (list: unknown): Coverage[] => {
  const rows = (Array.isArray(list) ? list : []).map(recordOf);
  const seen = new Set<string>();
  return rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => rank(a.r.priority) - rank(b.r.priority) || a.i - b.i)
    .flatMap(({ r }) => {
      const payer = payerNameOf(r);
      const memberId = textOrNull(r.memberId);
      if (!payer || seen.has(coverageKey(payer, memberId))) return [];
      seen.add(coverageKey(payer, memberId));
      return [
        {
          payer,
          payerId: textOrNull(r.payerId),
          payerCode: textOrNull(r.payerCode),
          memberId,
          groupId: textOrNull(r.groupId),
          relationship: relationshipOf(r.relationship),
          insuredFirstName: textOrNull(r.insuredFirstName),
          insuredLastName: textOrNull(r.insuredLastName)
        }
      ];
    });
};
