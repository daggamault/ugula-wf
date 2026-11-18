import { MAX_LINE_MODIFIERS, MODIFIER_PATTERN } from './adjudications.ts';
import {
  CLASSIFICATIONS,
  type Classification,
  HCPCS_PATTERN,
  SERVICE_LEVELS,
  type ServiceLevel
} from './charges.ts';
import {
  AMBULANCE_CONDITIONS,
  CONDITION_LIMIT,
  DIAGNOSIS_LIMIT,
  ICD10_PATTERN,
  INSURED_RELATIONSHIPS,
  type InsuredRelationship,
  isOriginDestination,
  SELF,
  TRANSPORT_REASONS,
  type TransportReason
} from './claim-details.ts';
import { readAddress } from './patients.ts';
import { isCents, textOrNull } from './values.ts';

export const CLAIM_STATUSES = ['needs_review', 'approved', 'on_hold'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  needs_review: 'Needs Review',
  approved: 'Approved',
  on_hold: 'On Hold'
};

export const CLAIM_DECISIONS = ['approved', 'on_hold'] as const;

export type ClaimDecision = (typeof CLAIM_DECISIONS)[number];

export type ClaimReview = {
  claimId: string;
  revision: number;
  decision: ClaimDecision;
  reviewedBy: string;
  note: string | null;
};

export const readClaimReview = (r: {
  claimId: string | null;
  revision: number | null;
  decision: string | null;
  reviewedBy: string | null;
  note: string | null;
}): ClaimReview => {
  const claimId = textOrNull(r.claimId);
  if (!claimId) throw new Error('A review needs its claim');
  if (r.revision === null || !Number.isInteger(r.revision) || r.revision < 1) {
    throw new Error('A review needs the revision of the claim reviewed');
  }
  const decision = r.decision as ClaimDecision;
  if (!CLAIM_DECISIONS.includes(decision)) throw new Error(`${r.decision} is not a decision`);
  const reviewedBy = textOrNull(r.reviewedBy);
  if (!reviewedBy) throw new Error('A review needs the biller who reviewed the claim');
  const note = textOrNull(r.note);
  if (decision === 'on_hold' && !note) throw new Error('A claim on hold needs a note saying why');
  return { claimId, revision: r.revision, decision, reviewedBy, note };
};

export type ClaimCoverage = {
  payerId: string | null;
  payerName: string;
  memberId: string | null;
  groupId: string | null;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
};

export type ClaimLocation = {
  name: string | null;
  line: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export const NOTE_LENGTH = 80;

type ClaimChargeLine = {
  code: string;
  modifiers: string[];
  units: number;
  unitCents: number;
  totalCents: number;
};

export type ClaimInput = {
  encounterId: string;
  patientId: string;
  classification: Classification;
  serviceDate: string | null;
  level: ServiceLevel;
  emergency: boolean;
  loadedMiles: number | null;
  originCode: string | null;
  destinationCode: string | null;
  diagnoses: string[];
  transportReason: TransportReason | null;
  conditionCodes: string[];
  weightPounds: number | null;
  pickup: ClaimLocation;
  destination: ClaimLocation;
  priorAuthorization: string | null;
  signatureOnFile: boolean;
  note: string | null;
  coverages: ClaimCoverage[];
  lines: ClaimChargeLine[];
  totalCents: number;
  reasons: string[];
};

export type StoredClaim = ClaimInput & { id: string; revision: number };

const HCPCS = new RegExp(HCPCS_PATTERN);

const MODIFIER = new RegExp(MODIFIER_PATTERN);

const ICD10 = new RegExp(ICD10_PATTERN);

type Maybe<T> = { [K in keyof T]: T[K] | null };

type LineValue = Maybe<Omit<ClaimChargeLine, 'modifiers'>> & {
  modifiers: (string | null)[] | null;
};

type CoverageValue = Maybe<Omit<ClaimCoverage, 'relationship'>> & { relationship: string | null };

type LocationValue = Maybe<ClaimLocation> | null;

export type ClaimValue = Maybe<
  Omit<
    ClaimInput,
    | 'classification'
    | 'level'
    | 'lines'
    | 'coverages'
    | 'diagnoses'
    | 'transportReason'
    | 'conditionCodes'
    | 'reasons'
    | 'pickup'
    | 'destination'
  >
> & {
  classification: string | null;
  level: string | null;
  diagnoses: (string | null)[] | null;
  transportReason: string | null;
  conditionCodes: (string | null)[] | null;
  coverages: (CoverageValue | null)[] | null;
  lines: (LineValue | null)[] | null;
  reasons: (string | null)[] | null;
  pickup: LocationValue;
  destination: LocationValue;
};

const present = <T>(xs: readonly (T | null)[] | null) =>
  (xs ?? []).flatMap((x) => (x === null ? [] : [x]));

const texts = (xs: readonly (string | null)[] | null) =>
  present(xs).flatMap((t) => textOrNull(t) ?? []);

const oneOf = <T extends string>(values: readonly T[], x: string | null, message: string): T => {
  if (!values.includes(x as T)) throw new Error(message);
  return x as T;
};

const required = (x: string | null, message: string) => {
  const text = textOrNull(x);
  if (!text) throw new Error(message);
  return text;
};

const dateOf = (x: string | null) => {
  const text = textOrNull(x);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) throw new Error(`The service date ${text} is not a date`);
  return text.slice(0, 10);
};

const milesOf = (x: number | null) => {
  if (x !== null && x < 0) throw new Error('Loaded miles must be zero or more');
  return x;
};

const readLine = (l: LineValue, i: number): ClaimChargeLine => {
  const code = textOrNull(l.code)?.toUpperCase() ?? '';
  if (!HCPCS.test(code)) throw new Error(`Line ${i + 1} has no valid HCPCS code`);
  const modifiers = texts(l.modifiers).map((m) => m.toUpperCase());
  const bad = modifiers.find((m) => !MODIFIER.test(m));
  if (bad) throw new Error(`Line ${i + 1} (${code}) has an invalid modifier ${bad}`);
  if (modifiers.length > MAX_LINE_MODIFIERS) {
    throw new Error(`Line ${i + 1} (${code}) has more than ${MAX_LINE_MODIFIERS} modifiers`);
  }
  const units = l.units ?? 0;
  if (units <= 0) {
    throw new Error(`Line ${i + 1} (${code}) needs a positive number of units`);
  }
  if (!isCents(l.unitCents) || !isCents(l.totalCents)) {
    throw new Error(`Line ${i + 1} (${code}) has not been priced`);
  }
  return { code, modifiers, units, unitCents: l.unitCents, totalCents: l.totalCents };
};

const readCoverage = (c: CoverageValue, i: number): ClaimCoverage => {
  const payerName = textOrNull(c.payerName);
  if (!payerName) throw new Error(`Payer ${i + 1} has no name`);
  return {
    payerId: textOrNull(c.payerId),
    payerName,
    memberId: textOrNull(c.memberId),
    groupId: textOrNull(c.groupId),
    relationship: oneOf(
      INSURED_RELATIONSHIPS,
      textOrNull(c.relationship) ?? SELF,
      `Payer ${i + 1} has a relationship that is not an X12 code`
    ),
    insuredFirstName: textOrNull(c.insuredFirstName),
    insuredLastName: textOrNull(c.insuredLastName)
  };
};

const readDiagnoses = (xs: (string | null)[] | null) => {
  const codes = [...new Set(texts(xs).map((c) => c.toUpperCase().replace('.', '')))];
  const bad = codes.find((c) => !ICD10.test(c));
  if (bad) throw new Error(`Diagnosis ${bad} is not an ICD-10 code`);
  if (codes.length > DIAGNOSIS_LIMIT) {
    throw new Error(`A claim takes at most ${DIAGNOSIS_LIMIT} diagnoses`);
  }
  return codes;
};

const TRANSPORT_REASON_CODES = Object.keys(TRANSPORT_REASONS) as TransportReason[];

const readTransportReason = (x: string | null): TransportReason | null => {
  const reason = textOrNull(x)?.toUpperCase() ?? null;
  return reason === null
    ? null
    : oneOf(TRANSPORT_REASON_CODES, reason, `${reason} is not a transport reason`);
};

const readConditionCodes = (xs: (string | null)[] | null) => {
  const codes = [...new Set(texts(xs))];
  const bad = codes.find((c) => !Object.hasOwn(AMBULANCE_CONDITIONS, c));
  if (bad) throw new Error(`${bad} is not an ambulance condition code`);
  if (codes.length > CONDITION_LIMIT) {
    throw new Error(`A claim takes at most ${CONDITION_LIMIT} condition codes`);
  }
  return codes;
};

const readWeight = (x: number | null) => {
  if (x !== null && !(Number.isInteger(x) && x > 0)) {
    throw new Error('The weight must be a whole number of pounds');
  }
  return x;
};

const readOriginDestination = (origin: string | null, destination: string | null) => {
  const o = textOrNull(origin)?.toUpperCase() ?? null;
  const d = textOrNull(destination)?.toUpperCase() ?? null;
  if (o === null && d === null) return { originCode: null, destinationCode: null };
  if (!isOriginDestination(`${o ?? ''}${d ?? ''}`)) {
    throw new Error(`${o ?? '?'}${d ?? '?'} is not an origin and destination modifier`);
  }
  return { originCode: o, destinationCode: d };
};

const readLocation = (l: LocationValue): ClaimLocation => {
  const a = readAddress({
    addressLine: l?.line,
    city: l?.city,
    state: l?.state,
    postalCode: l?.postalCode
  });
  return {
    name: textOrNull(l?.name),
    line: a.addressLine,
    city: a.city,
    state: a.state,
    postalCode: a.postalCode
  };
};

const readNote = (x: string | null) => {
  const note = textOrNull(x);
  if (note !== null && note.length > NOTE_LENGTH) {
    throw new Error(`The claim note takes at most ${NOTE_LENGTH} characters`);
  }
  return note;
};

export const readClaim = (c: ClaimValue): ClaimInput => {
  const lines = present(c.lines).map(readLine);
  const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  const total = c.totalCents ?? null;
  if (total !== null && total !== totalCents) {
    throw new Error(`The total ${total} is not the sum of the lines, ${totalCents}`);
  }
  const emergency = c.emergency ?? null;
  if (emergency === null) throw new Error('A claim needs to say if it is an emergency');
  return {
    encounterId: required(c.encounterId, 'A claim needs its encounter'),
    patientId: required(c.patientId, 'A claim needs its patient'),
    classification: oneOf(
      CLASSIFICATIONS,
      c.classification,
      `${c.classification} is not a classification`
    ),
    serviceDate: dateOf(c.serviceDate),
    level: oneOf(SERVICE_LEVELS, c.level, `${c.level} is not a level of service`),
    emergency,
    loadedMiles: milesOf(c.loadedMiles ?? null),
    ...readOriginDestination(c.originCode, c.destinationCode),
    diagnoses: readDiagnoses(c.diagnoses),
    transportReason: readTransportReason(c.transportReason),
    conditionCodes: readConditionCodes(c.conditionCodes),
    weightPounds: readWeight(c.weightPounds ?? null),
    pickup: readLocation(c.pickup ?? null),
    destination: readLocation(c.destination ?? null),
    priorAuthorization: textOrNull(c.priorAuthorization),
    signatureOnFile: c.signatureOnFile ?? false,
    note: readNote(c.note ?? null),
    coverages: present(c.coverages).map(readCoverage),
    lines,
    totalCents,
    reasons: texts(c.reasons)
  };
};
