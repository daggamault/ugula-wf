import { isRecord } from '@ugula/graph';
import {
  type Classification,
  isClassification,
  isServiceLevel,
  isTransport,
  NO_TRANSPORT_TRIPS,
  type PricedLine,
  readPricedLines,
  SERVICE_LEVELS,
  type ServiceLevel
} from './charges.ts';
import {
  type ClaimDetails,
  type Coverage,
  isOriginDestination,
  readClaimDetails,
  readCoverages,
  SELF
} from './claim-details.ts';
import type { DocumentKind } from './claim-documents.ts';
import { formatIcd10, ICD10CM_FROM } from './code-sets.ts';
import { daysBetween } from './documentation.ts';
import type { CheckedFacility, ResponsibleParty } from './facilities.ts';
import type { Address } from './patients.ts';
import type { EligibilityStatus } from './payer-files.ts';
import { filingLimitOf, isMedicareFiling } from './payers.ts';
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

const ADDRESS_PARTS = [
  ['addressLine', 'street address'],
  ['city', 'city'],
  ['state', 'state'],
  ['postalCode', 'ZIP code']
] as const;

const missingParts = (a: Address | null) =>
  a ? ADDRESS_PARTS.flatMap(([part, name]) => (a[part] ? [] : [name])) : [];

export const STAY_KINDS = ['inpatient', 'snf'] as const;

export type StayKind = (typeof STAY_KINDS)[number];

const checkedDiagnoses = (c: ClaimCheck) =>
  c.details.serviceDate !== null && c.details.serviceDate < ICD10CM_FROM ? [] : c.diagnosisCodes;

const zipStateMismatches = (c: ClaimCheck) =>
  (
    [
      ['pickup', c.details.pickup.state],
      ['destination', c.details.destination.state],
      ['patient', c.patient?.state ?? null]
    ] as const
  ).flatMap(([place, state]) => {
    const zipState = c.zipStates[place];
    return zipState && state && zipState !== state ? [place] : [];
  });

const before = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(b) < Date.parse(a);

const transports = (c: ClaimCheck) =>
  !c.deceased &&
  (c.classification
    ? !NO_TRANSPORT_TRIPS.includes(c.classification as Classification)
    : isTransport(c.lines));

const within = (day: string | null, stay: ReportedStay) =>
  day !== null &&
  (stay.admittedOn === null || stay.admittedOn <= day) &&
  (stay.dischargedOn === null || day <= stay.dischargedOn);

const payerFacts = (serviceDate: string | null, today: string) => (p: CheckedPayer) => {
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
    filingDaysLeft: limit === null || !serviceDate ? null : limit - daysBetween(serviceDate, today),
    medicare: isMedicareFiling(p.claimFiling),
    stayReported: p.stay && within(serviceDate, p.stay) ? p.stay.kind : null
  };
};

export const checkFactsOf = (c: ClaimCheck, asOf: Date) => {
  const { serviceDate, documentation: d } = c.details;
  return {
    patientLinked: c.patientId !== null,
    patientAddressMissing: missingParts(c.patient),
    pcrNumber: c.pcrNumber,
    serviceDate,
    classification: c.classification,
    transports: transports(c),
    level: c.level,
    levelValid: isServiceLevel(c.level),
    emergency: c.emergency,
    lineCount: c.lines.length,
    linesAddUp: c.lines.reduce((sum, l) => sum + l.totalCents, 0) === c.totalCents,
    diagnosisCount: c.details.diagnoses.length,
    unknownDiagnoses: checkedDiagnoses(c).flatMap((d) =>
      d.description === null ? [formatIcd10(d.code)] : []
    ),
    unbillableDiagnoses: checkedDiagnoses(c).flatMap((d) =>
      d.description !== null && !d.billable ? [`${d.description} (${formatIcd10(d.code)})`] : []
    ),
    pickupMissing: missingParts(c.details.pickup),
    pickupZipPriced: c.details.pickup.postalCode ? c.pickupLocality !== null : null,
    pickupZipNeedsPlusFour:
      c.pickupLocality?.needsPlusFour === true && (c.details.pickup.postalCode ?? '').length < 9,
    zipStateMismatches: zipStateMismatches(c),
    destinationMissing: missingParts(c.details.destination),
    originDestinationValid: isOriginDestination(c.details.originDestination),
    transportReason: d.transportReason,
    conditionsDocumented: d.conditionCodes.length > 0,
    timesRecorded: Boolean(d.leftScene && d.atDestination),
    timesInOrder: !before(d.atScene, d.leftScene) && !before(d.leftScene, d.atDestination),
    loadedMiles: c.loadedMiles,
    signature: d.signature,
    signatureNote: d.signatureNote,
    pcsOnFile: d.pcsOnFile,
    pcsSignedOn: d.pcsSignedOn,
    pcsDaysBeforeTrip:
      d.pcsSignedOn && serviceDate ? daysBetween(d.pcsSignedOn, serviceDate) : null,
    billsMedicare: c.payers.some((p) => isMedicareFiling(p.claimFiling)),
    payers: c.payers.map(payerFacts(serviceDate, localDate(asOf, c.timeZone))),
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
    priorAuthorization: d.priorAuthorization,
    priorAuthorizationDaysLeft:
      d.priorAuthorizationExpiresOn && serviceDate
        ? daysBetween(serviceDate, d.priorAuthorizationExpiresOn)
        : null,
    pcsType: d.pcsType,
    roundTrips: d.roundTrips,
    facilityStay: d.facilityStay,
    pickupFacility: c.pickupFacility,
    destinationFacility: c.destinationFacility,
    responsibleParty: c.responsibleParty,
    recordedParty: c.responsibilityRecorded ? c.responsibleParty : null,
    documents: c.documents
  };
};

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
