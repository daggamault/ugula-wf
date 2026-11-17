import { MAX_LINE_MODIFIERS, MODIFIER_PATTERN } from './adjudications.ts';
import {
  CLASSIFICATIONS,
  type Classification,
  HCPCS_PATTERN,
  SERVICE_LEVELS,
  type ServiceLevel
} from './charges.ts';
import {
  DIAGNOSIS_LIMIT,
  ICD10_PATTERN,
  INSURED_RELATIONSHIPS,
  type InsuredRelationship,
  isOriginDestination,
  SELF
} from './claim-details.ts';
import { isCents, recordOf, textOrNull } from './values.ts';

export const CLAIM_STATUSES = ['needs_review'] as const;

export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  needs_review: 'Needs Review'
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

export type ClaimChargeLine = {
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
  coverages: ClaimCoverage[];
  lines: ClaimChargeLine[];
  totalCents: number;
  reasons: string[];
};

const HCPCS = new RegExp(HCPCS_PATTERN);

const MODIFIER = new RegExp(MODIFIER_PATTERN);

const ICD10 = new RegExp(ICD10_PATTERN);

const listOf = (x: unknown) => (Array.isArray(x) ? x : []);

const texts = (x: unknown) => listOf(x).flatMap((t) => textOrNull(t) ?? []);

const oneOf = <T extends string>(values: readonly T[], x: unknown, message: string): T => {
  if (!values.includes(x as T)) throw new Error(message);
  return x as T;
};

const required = (x: unknown, message: string) => {
  const text = textOrNull(x);
  if (!text) throw new Error(message);
  return text;
};

const dateOf = (x: unknown) => {
  const text = textOrNull(x);
  if (text === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}/.test(text)) throw new Error(`The service date ${text} is not a date`);
  return text.slice(0, 10);
};

const milesOf = (x: unknown) => {
  if (x === null || x === undefined) return null;
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) {
    throw new Error('Loaded miles must be zero or more');
  }
  return x;
};

const readLine = (x: unknown, i: number): ClaimChargeLine => {
  const r = recordOf(x);
  const code = textOrNull(r.code)?.toUpperCase() ?? '';
  if (!HCPCS.test(code)) throw new Error(`Line ${i + 1} has no valid HCPCS code`);
  const modifiers = texts(r.modifiers).map((m) => m.toUpperCase());
  const bad = modifiers.find((m) => !MODIFIER.test(m));
  if (bad) throw new Error(`Line ${i + 1} (${code}) has an invalid modifier ${bad}`);
  if (modifiers.length > MAX_LINE_MODIFIERS) {
    throw new Error(`Line ${i + 1} (${code}) has more than ${MAX_LINE_MODIFIERS} modifiers`);
  }
  const units = r.units;
  if (typeof units !== 'number' || !Number.isFinite(units) || units <= 0) {
    throw new Error(`Line ${i + 1} (${code}) needs a positive number of units`);
  }
  if (!isCents(r.unitCents) || !isCents(r.totalCents)) {
    throw new Error(`Line ${i + 1} (${code}) has not been priced`);
  }
  return { code, modifiers, units, unitCents: r.unitCents, totalCents: r.totalCents };
};

const readCoverage = (x: unknown, i: number): ClaimCoverage => {
  const r = recordOf(x);
  const payerName = textOrNull(r.payerName);
  if (!payerName) throw new Error(`Payer ${i + 1} has no name`);
  return {
    payerId: textOrNull(r.payerId),
    payerName,
    memberId: textOrNull(r.memberId),
    groupId: textOrNull(r.groupId),
    relationship: oneOf(
      INSURED_RELATIONSHIPS,
      textOrNull(r.relationship) ?? SELF,
      `Payer ${i + 1} has a relationship that is not an X12 code`
    ),
    insuredFirstName: textOrNull(r.insuredFirstName),
    insuredLastName: textOrNull(r.insuredLastName)
  };
};

const readDiagnoses = (x: unknown) => {
  const codes = [...new Set(texts(x).map((c) => c.toUpperCase().replace('.', '')))];
  const bad = codes.find((c) => !ICD10.test(c));
  if (bad) throw new Error(`Diagnosis ${bad} is not an ICD-10 code`);
  if (codes.length > DIAGNOSIS_LIMIT) {
    throw new Error(`A claim takes at most ${DIAGNOSIS_LIMIT} diagnoses`);
  }
  return codes;
};

const readOriginDestination = (origin: unknown, destination: unknown) => {
  const o = textOrNull(origin)?.toUpperCase() ?? null;
  const d = textOrNull(destination)?.toUpperCase() ?? null;
  if (o === null && d === null) return { originCode: null, destinationCode: null };
  if (!isOriginDestination(`${o ?? ''}${d ?? ''}`)) {
    throw new Error(`${o ?? '?'}${d ?? '?'} is not an origin and destination modifier`);
  }
  return { originCode: o, destinationCode: d };
};

export const readClaim = (x: unknown): ClaimInput => {
  const c = recordOf(x);
  const lines = listOf(c.lines).map(readLine);
  const totalCents = lines.reduce((sum, l) => sum + l.totalCents, 0);
  if (c.totalCents !== null && c.totalCents !== undefined && c.totalCents !== totalCents) {
    throw new Error(`The total ${String(c.totalCents)} is not the sum of the lines, ${totalCents}`);
  }
  if (typeof c.emergency !== 'boolean')
    throw new Error('A claim needs to say if it is an emergency');
  return {
    encounterId: required(c.encounterId, 'A claim needs its encounter'),
    patientId: required(c.patientId, 'A claim needs its patient'),
    classification: oneOf(
      CLASSIFICATIONS,
      c.classification,
      `${String(c.classification)} is not a classification`
    ),
    serviceDate: dateOf(c.serviceDate),
    level: oneOf(SERVICE_LEVELS, c.level, `${String(c.level)} is not a level of service`),
    emergency: c.emergency,
    loadedMiles: milesOf(c.loadedMiles),
    ...readOriginDestination(c.originCode, c.destinationCode),
    diagnoses: readDiagnoses(c.diagnoses),
    coverages: listOf(c.coverages).map(readCoverage),
    lines,
    totalCents,
    reasons: texts(c.reasons)
  };
};
