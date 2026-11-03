import { isRecord } from '@ugula/graph';
import {
  isServiceLevel,
  isTransport,
  isTripType,
  LIKELY_LOADED_MILES,
  MAX_LOADED_MILES,
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
import type { Address } from './patients.ts';
import { textOrNull } from './values.ts';

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

export const CLAIM_ISSUE_LEVELS = ['blocking', 'warning'] as const;

export type ClaimIssueLevel = (typeof CLAIM_ISSUE_LEVELS)[number];

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
  'insured'
] as const;

export type ClaimField = (typeof CLAIM_FIELDS)[number];

export type ClaimIssue = {
  level: ClaimIssueLevel;
  field: ClaimField;
  message: string;
  coverageId: string | null;
};

export type CheckedPayer = {
  coverageId: string | null;
  name: string;
  payerId: string | null;
  claimFiling: string | null;
  memberId: string | null;
  relationship: string;
  insuredFirstName: string | null;
  insuredLastName: string | null;
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

const MAX_PAYERS = 11;

const issue =
  (level: ClaimIssueLevel) =>
  (field: ClaimField, message: string, coverageId: string | null = null): ClaimIssue[] => [
    { level, field, message, coverageId }
  ];

const blocking = issue('blocking');

const warning = issue('warning');

const when = (cond: boolean, issues: ClaimIssue[]) => (cond ? issues : []);

const ADDRESS_PARTS = [
  ['addressLine', 'street address'],
  ['city', 'city'],
  ['state', 'state'],
  ['postalCode', 'ZIP code']
] as const;

const addressIssues = (field: ClaimField, label: string, a: Address) =>
  ADDRESS_PARTS.flatMap(([part, name]) =>
    when(!a[part], blocking(field, `The ${label} ${name} is missing`))
  );

const payerIssues = (p: CheckedPayer) => [
  ...when(
    !p.payerId || !p.claimFiling,
    blocking('payer', `${p.name} is not linked to the payer directory`, p.coverageId)
  ),
  ...when(
    !p.memberId,
    blocking('memberId', `The member ID for ${p.name} is missing`, p.coverageId)
  ),
  ...when(
    p.relationship !== SELF && !p.insuredLastName,
    blocking('insured', `The insured's last name for ${p.name} is missing`, p.coverageId)
  )
];

const transports = (c: ClaimCheck) =>
  c.tripType ? !NO_TRANSPORT_TRIPS.includes(c.tripType as TripType) : isTransport(c.lines);

const mileageIssues = (miles: number | null) =>
  miles === null || miles <= 0
    ? blocking('loadedMiles', 'Loaded miles are missing')
    : miles > MAX_LOADED_MILES
      ? blocking('loadedMiles', `Loaded miles are over ${MAX_LOADED_MILES}`)
      : when(
          miles > LIKELY_LOADED_MILES,
          warning(
            'loadedMiles',
            `Loaded miles are over ${LIKELY_LOADED_MILES}; check the odometers`
          )
        );

const tripIssues = (c: ClaimCheck) =>
  transports(c)
    ? [
        ...addressIssues('destination', 'destination', c.details.destination),
        ...when(
          !isOriginDestination(c.details.originDestination),
          blocking('originDestination', 'The origin/destination modifier is missing')
        ),
        ...mileageIssues(c.loadedMiles)
      ]
    : when(
        c.loadedMiles !== null && c.loadedMiles > 0,
        warning('loadedMiles', 'Loaded miles are recorded on a trip without transport')
      );

const lineIssues = (c: ClaimCheck) =>
  !c.lines.length
    ? blocking('lines', 'The claim has no charge lines')
    : when(
        c.lines.reduce((sum, l) => sum + l.totalCents, 0) !== c.totalCents,
        blocking('lines', 'The claim total does not add up to its lines')
      );

export const claimIssues = (c: ClaimCheck): ClaimIssue[] => [
  ...when(!c.patientId, blocking('patient', 'The claim has no patient')),
  ...(c.patient ? addressIssues('patientAddress', "patient's", c.patient) : []),
  ...when(
    !c.pcrNumber,
    warning('pcrNumber', 'The report has no PCR number, so a corrected report opens a new claim')
  ),
  ...when(!c.details.serviceDate, blocking('serviceDate', 'The date of service is missing')),
  ...when(
    c.tripType === 'noClaim',
    blocking('tripType', 'The trip is classified as needing no claim; choose the trip type billed')
  ),
  ...when(
    !isServiceLevel(c.level),
    blocking('level', `Choose a level of service: ${SERVICE_LEVELS.join(', ')}`)
  ),
  ...when(c.emergency === null, blocking('emergency', 'Say whether the response was an emergency')),
  ...when(
    c.tripType === 'scheduled' && c.emergency === true,
    warning('emergency', 'A scheduled trip is marked as an emergency response')
  ),
  ...lineIssues(c),
  ...when(
    !c.details.diagnoses.length,
    blocking('diagnoses', 'At least one diagnosis code is required')
  ),
  ...addressIssues('pickup', 'pickup', c.details.pickup),
  ...tripIssues(c),
  ...when(
    !c.payers.length,
    warning('payers', 'No payer is on the claim, so the patient is billed')
  ),
  ...when(
    c.payers.length > MAX_PAYERS,
    blocking('payers', `An 837P claim carries at most ${MAX_PAYERS} payers`)
  ),
  ...c.payers.flatMap(payerIssues)
];

export const isBlocking = (issues: readonly ClaimIssue[]) =>
  issues.some((i) => i.level === 'blocking');

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
