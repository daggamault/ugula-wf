import { isRecord } from '@ugula/graph';
import {
  type Classification,
  isClassification,
  isServiceLevel,
  type PricedLine,
  readPricedLines,
  SERVICE_LEVELS,
  type ServiceLevel
} from './charges.ts';
import {
  type ClaimDetails,
  type Coverage,
  readClaimDetails,
  readCoverages
} from './claim-details.ts';
import type { DocumentKind } from './claim-documents.ts';
import { formatIcd10 } from './code-sets.ts';
import type { CheckedFacility, ResponsibleParty } from './facilities.ts';
import type { Address } from './patients.ts';
import type { EligibilityStatus } from './payer-files.ts';
import { localDate } from './statements.ts';
import { recordOf, textOrNull } from './values.ts';

export type NewClaim = {
  patientId: string;
  pcrNumber: string | null;
  classification: Classification | null;
  level: ServiceLevel;
  emergency: boolean;
  loadedMiles: number | null;
  deceased: boolean;
  nonCoveredMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  coverages: Coverage[];
  details: ClaimDetails;
  reportKey: string | null;
};

export const CLAIM_ISSUE_SEVERITIES = ['blocking', 'warning'] as const;

type ClaimIssueSeverity = (typeof CLAIM_ISSUE_SEVERITIES)[number];

export const CLAIM_FIELDS = [
  'patient',
  'patientAddress',
  'pcrNumber',
  'serviceDate',
  'classification',
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
  'submission',
  'deceased',
  'nonCoveredMiles',
  'patientCount',
  'abn',
  'msp',
  'priorAuthorization',
  'facility'
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
  stay: ReportedStay | null;
};

export type ReportedStay = {
  kind: StayKind;
  admittedOn: string | null;
  dischargedOn: string | null;
};

type CheckedDiagnosis = { code: string; description: string | null; billable: boolean };

type ZipStates = { pickup: string | null; destination: string | null; patient: string | null };

export type ClaimCheck = {
  patientId: string | null;
  patient: Address | null;
  pcrNumber: string | null;
  classification: string | null;
  level: string | null;
  emergency: boolean | null;
  loadedMiles: number | null;
  deceased: boolean;
  nonCoveredMiles: number | null;
  lines: PricedLine[];
  totalCents: number;
  payers: CheckedPayer[];
  details: ClaimDetails;
  pickupFacility: CheckedFacility | null;
  destinationFacility: CheckedFacility | null;
  responsibleParty: ResponsibleParty;
  responsibilityRecorded: boolean;
  pickupLocality: { needsPlusFour: boolean } | null;
  zipStates: ZipStates;
  diagnosisCodes: CheckedDiagnosis[];
  documents: DocumentKind[];
  timeZone: string;
};

export const STAY_KINDS = ['inpatient', 'snf'] as const;

export type StayKind = (typeof STAY_KINDS)[number];

const addressOf = (a: Address | null) => ({
  addressLine: a?.addressLine ?? null,
  city: a?.city ?? null,
  state: a?.state ?? null,
  postalCode: a?.postalCode ?? null
});

export const claimRecordOf = (c: ClaimCheck, asOf: Date) => {
  const { serviceDate, documentation: d } = c.details;
  return {
    today: localDate(asOf, c.timeZone),
    patientId: c.patientId,
    patient: c.patient ? addressOf(c.patient) : null,
    pcrNumber: c.pcrNumber,
    serviceDate,
    classification: c.classification,
    level: c.level,
    emergency: c.emergency,
    lineCodes: c.lines.map((l) => l.code),
    lineTotalCents: c.lines.map((l) => l.totalCents),
    totalCents: c.totalCents,
    diagnosisCount: c.details.diagnoses.length,
    diagnoses: c.diagnosisCodes.map((x) => ({
      code: formatIcd10(x.code),
      description: x.description,
      billable: x.billable
    })),
    pickup: addressOf(c.details.pickup),
    destination: addressOf(c.details.destination),
    pickupZipKnown: c.details.pickup.postalCode ? c.pickupLocality !== null : null,
    pickupZipSplit: c.pickupLocality?.needsPlusFour === true,
    pickupZipState: c.zipStates.pickup,
    destinationZipState: c.zipStates.destination,
    patientZipState: c.zipStates.patient,
    originDestination: c.details.originDestination,
    transportReason: d.transportReason,
    conditionCodes: d.conditionCodes,
    atScene: d.atScene,
    leftScene: d.leftScene,
    atDestination: d.atDestination,
    loadedMiles: c.loadedMiles,
    signature: d.signature,
    signatureNote: d.signatureNote,
    pcsOnFile: d.pcsOnFile,
    pcsSignedOn: d.pcsSignedOn,
    pcsType: d.pcsType,
    roundTrips: d.roundTrips,
    priorAuthorization: d.priorAuthorization,
    priorAuthorizationExpiresOn: d.priorAuthorizationExpiresOn,
    deceased: c.deceased,
    nonCoveredMiles: c.nonCoveredMiles,
    patientCount: d.patientCount,
    abnOnFile: d.abnOnFile,
    abnSignedOn: d.abnSignedOn,
    denialExpected: d.denialExpected,
    mspEmployerPlan: d.mspEmployerPlan,
    mspEsrd: d.mspEsrd,
    mspDisability: d.mspDisability,
    mspEmployerSize: d.mspEmployerSize,
    mspAccident: d.mspAccident,
    facilityStay: d.facilityStay,
    payers: c.payers.map((p) => ({
      coverageId: p.coverageId,
      name: p.name,
      payerId: p.payerId,
      claimFiling: p.claimFiling,
      memberId: p.memberId,
      relationship: p.relationship,
      insuredLastName: p.insuredLastName,
      filingLimitDays: p.filingLimitDays,
      eligibility: p.eligibility,
      eligibilityNote: p.eligibilityNote,
      stayKind: p.stay?.kind ?? null,
      stayAdmittedOn: p.stay?.admittedOn ?? null,
      stayDischargedOn: p.stay?.dischargedOn ?? null
    })),
    pickupFacility: c.pickupFacility,
    destinationFacility: c.destinationFacility,
    responsibleParty: c.responsibleParty,
    responsibilityRecorded: c.responsibilityRecorded,
    documents: c.documents
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

export const readNewClaim = (claim: unknown): NewClaim => {
  const c = isRecord(claim) ? claim : {};
  const patientId = textOrNull(c.patientId);
  if (!patientId) throw new Error('A claim needs a patient');
  if (!isServiceLevel(c.level)) {
    throw new Error(`A claim needs a level of service: ${SERVICE_LEVELS.join(', ')}`);
  }
  const lines = readPricedLines(c.lines);
  const report = isRecord(c.report) ? c.report : {};
  const classification = textOrNull(c.classification);
  return {
    patientId,
    pcrNumber: textOrNull(c.pcrNumber),
    classification: isClassification(classification) ? classification : null,
    level: c.level,
    emergency: c.emergency === true,
    loadedMiles: typeof c.loadedMiles === 'number' ? c.loadedMiles : null,
    deceased: c.deceased === true,
    nonCoveredMiles:
      typeof c.nonCoveredMiles === 'number' && c.nonCoveredMiles > 0 ? c.nonCoveredMiles : null,
    lines,
    totalCents: lines.reduce((sum, l) => sum + l.totalCents, 0),
    coverages: readCoverages(c.coverages),
    details: readClaimDetails(c),
    reportKey: textOrNull(report.key)
  };
};
