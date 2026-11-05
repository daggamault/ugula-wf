import { isRecord } from '@ugula/graph';
import {
  isServiceLevel,
  isTransport,
  isTripType,
  NO_TRANSPORT_TRIPS,
  type PricedLine,
  readPricedLines,
  SERVICE_LEVELS,
  type TripType
} from './charges.ts';
import {
  type ClaimDetails,
  type Coverage,
  isOriginDestination,
  readClaimDetails,
  readCoverages,
  SELF
} from './claim-details.ts';
import { daysBetween } from './documentation.ts';
import type { Address } from './patients.ts';
import type { EligibilityStatus } from './payer-files.ts';
import { filingLimitOf } from './payers.ts';
import { recordOf, textOrNull } from './values.ts';

export type NewClaim = {
  patientId: string;
  pcrNumber: string | null;
  tripType: TripType | null;
  level: string;
  emergency: boolean;
  loadedMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  coverages: Coverage[];
  details: ClaimDetails;
  reportKey: string | null;
};

export const CLAIM_ISSUE_SEVERITIES = ['blocking', 'warning'] as const;

export type ClaimIssueSeverity = (typeof CLAIM_ISSUE_SEVERITIES)[number];

export const CHECK_SEVERITIES = [...CLAIM_ISSUE_SEVERITIES, 'off'] as const;

export const CLAIM_FIELDS = [
  'patient',
  'patientAddress',
  'pcrNumber',
  'serviceDate',
  'tripType',
  'level',
  'emergency',
  'loadedMiles',
  'lines',
  'diagnoses',
  'pickup',
  'destination',
  'originDestination',
  'payers',
  'payer',
  'memberId',
  'insured',
  'signature',
  'pcs',
  'transportReason',
  'times',
  'filing',
  'submission'
] as const;

export type ClaimField = (typeof CLAIM_FIELDS)[number];

export type ClaimIssue = {
  code: string;
  severity: ClaimIssueSeverity;
  field: ClaimField;
  message: string;
  coverageId: string | null;
};

type CheckedPayer = {
  coverageId: string | null;
  name: string;
  payerId: string | null;
  claimFiling: string | null;
  memberId: string | null;
  relationship: string;
  insuredFirstName: string | null;
  insuredLastName: string | null;
  filingLimitDays: number | null;
  eligibility: EligibilityStatus | null;
  eligibilityNote: string | null;
};

export type ClaimCheck = {
  patientId: string | null;
  patient: Address | null;
  pcrNumber: string | null;
  tripType: string | null;
  level: string | null;
  emergency: boolean | null;
  loadedMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  payers: CheckedPayer[];
  details: ClaimDetails;
};

const ADDRESS_PARTS = [
  ['addressLine', 'street address'],
  ['city', 'city'],
  ['state', 'state'],
  ['postalCode', 'ZIP code']
] as const;

const missingParts = (a: Address | null) =>
  a ? ADDRESS_PARTS.flatMap(([part, name]) => (a[part] ? [] : [name])) : [];

const MEDICARE_FILINGS = ['MA', 'MB'];

const before = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(b) < Date.parse(a);

const transports = (c: ClaimCheck) =>
  c.tripType ? !NO_TRANSPORT_TRIPS.includes(c.tripType as TripType) : isTransport(c.lines);

const payerFacts = (serviceDate: string | null, asOf: Date) => (p: CheckedPayer) => {
  const limit = filingLimitOf(p.claimFiling, p.filingLimitDays);
  return {
    coverageId: p.coverageId,
    name: p.name,
    linked: Boolean(p.payerId && p.claimFiling),
    memberId: p.memberId,
    needsInsured: p.relationship !== SELF,
    insuredLastName: p.insuredLastName,
    eligibility: p.eligibility,
    eligibilityNote: p.eligibilityNote,
    filingLimitDays: limit,
    filingDaysLeft:
      limit === null || !serviceDate ? null : limit - daysBetween(serviceDate, asOf.toISOString())
  };
};

export type CheckFacts = ReturnType<typeof checkFactsOf>;

export const checkFactsOf = (c: ClaimCheck, asOf: Date) => {
  const { serviceDate, documentation: d } = c.details;
  return {
    patientLinked: c.patientId !== null,
    patientAddressMissing: missingParts(c.patient),
    pcrNumber: c.pcrNumber,
    serviceDate,
    tripType: c.tripType,
    transports: transports(c),
    level: c.level,
    levelValid: isServiceLevel(c.level),
    emergency: c.emergency,
    lineCount: c.lines.length,
    linesAddUp: c.lines.reduce((sum, l) => sum + l.totalCents, 0) === c.totalCents,
    diagnosisCount: c.details.diagnoses.length,
    pickupMissing: missingParts(c.details.pickup),
    destinationMissing: missingParts(c.details.destination),
    originDestinationValid: isOriginDestination(c.details.originDestination),
    transportReason: d.transportReason,
    timesRecorded: Boolean(d.leftScene && d.atDestination),
    timesInOrder: !before(d.atScene, d.leftScene) && !before(d.leftScene, d.atDestination),
    loadedMiles: c.loadedMiles,
    signature: d.signature,
    signatureNote: d.signatureNote,
    pcsOnFile: d.pcsOnFile,
    pcsSignedOn: d.pcsSignedOn,
    pcsDaysBeforeTrip:
      d.pcsSignedOn && serviceDate ? daysBetween(d.pcsSignedOn, serviceDate) : null,
    billsMedicare: c.payers.some(
      (p) => p.claimFiling !== null && MEDICARE_FILINGS.includes(p.claimFiling)
    ),
    payers: c.payers.map(payerFacts(serviceDate, asOf))
  };
};

const isSeverity = (x: unknown): x is ClaimIssueSeverity =>
  CLAIM_ISSUE_SEVERITIES.includes(x as ClaimIssueSeverity);

const isField = (x: unknown): x is ClaimField => CLAIM_FIELDS.includes(x as ClaimField);

export const readIssues = (x: unknown): ClaimIssue[] =>
  (Array.isArray(x) ? x : []).flatMap((item) => {
    const r = recordOf(item);
    const message = textOrNull(r.message);
    return isSeverity(r.severity) && isField(r.field) && message
      ? [
          {
            code: textOrNull(r.code) ?? r.field,
            severity: r.severity,
            field: r.field,
            message,
            coverageId: textOrNull(r.coverageId)
          }
        ]
      : [];
  });

export const isBlocking = (issues: readonly ClaimIssue[]) =>
  issues.some((i) => i.severity === 'blocking');

export const readNewClaim = (claim: unknown): NewClaim => {
  const c = isRecord(claim) ? claim : {};
  const patientId = textOrNull(c.patientId);
  if (!patientId) throw new Error('A claim needs a patient');
  if (!isServiceLevel(c.level)) {
    throw new Error(`A claim needs a level of service: ${SERVICE_LEVELS.join(', ')}`);
  }
  const lines = readPricedLines(c.lines);
  const report = isRecord(c.report) ? c.report : {};
  const tripType = textOrNull(c.tripType);
  return {
    patientId,
    pcrNumber: textOrNull(c.pcrNumber),
    tripType: isTripType(tripType) ? tripType : null,
    level: c.level,
    emergency: c.emergency === true,
    loadedMiles: typeof c.loadedMiles === 'number' ? c.loadedMiles : null,
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
    coverages: readCoverages(c.coverages),
    details: readClaimDetails(c),
    reportKey: textOrNull(report.key)
  };
};
