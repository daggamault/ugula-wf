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
import { type Documentation, daysBetween, PCS_LATE_DAYS, PCS_VALID_DAYS } from './documentation.ts';
import type { Address } from './patients.ts';
import type { EligibilityStatus } from './payer-files.ts';
import { filingLimitOf } from './payers.ts';
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
  ),
  ...when(
    p.eligibility === 'inactive',
    blocking(
      'payer',
      `${p.name} reports this coverage is not active${p.eligibilityNote ? ` (${p.eligibilityNote})` : ''}; fix the member ID or remove the payer`,
      p.coverageId
    )
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

const MEDICARE_FILINGS = ['MA', 'MB'];

const billsMedicare = (c: ClaimCheck) =>
  c.payers.some((p) => p.claimFiling !== null && MEDICARE_FILINGS.includes(p.claimFiling));

const signatureIssues = ({ signature, signatureNote }: Documentation) =>
  signature === 'signed'
    ? []
    : signature === 'exception'
      ? warning(
          'signature',
          `${signatureNote ?? 'The patient could not sign'}; keep the crew statement and the receiving facility's name and date with the claim`
        )
      : blocking(
          'signature',
          signature === 'refused'
            ? 'The patient refused to sign the release for billing; get a signature before billing a payer'
            : `${signatureNote ?? 'No billing signature'}; get the patient's or a representative's signature`
        );

const pcsIssues = (c: ClaimCheck) => {
  const { pcsOnFile, pcsSignedOn } = c.details.documentation;
  if (c.tripType !== 'scheduled' || c.emergency === true) return [];
  if (pcsOnFile !== true) {
    return issue(billsMedicare(c) ? 'blocking' : 'warning')(
      'pcs',
      'A scheduled non-emergency transport needs a physician certification statement'
    );
  }
  if (!pcsSignedOn || !c.details.serviceDate) {
    return warning('pcs', 'The physician certification statement has no signed date');
  }
  const days = daysBetween(pcsSignedOn, c.details.serviceDate);
  return days > PCS_VALID_DAYS
    ? warning(
        'pcs',
        `The physician certification statement was signed ${days} days before the trip; repetitive transports need one from the last ${PCS_VALID_DAYS} days`
      )
    : when(
        days < -PCS_LATE_DAYS,
        warning(
          'pcs',
          `The physician certification statement was signed more than ${PCS_LATE_DAYS} days after the trip`
        )
      );
};

const before = (a: string | null, b: string | null) =>
  a !== null && b !== null && Date.parse(b) < Date.parse(a);

const timeIssues = ({ atScene, leftScene, atDestination }: Documentation) =>
  !leftScene || !atDestination
    ? warning(
        'times',
        'The report does not say when the patient left the scene and arrived at the destination'
      )
    : when(
        before(atScene, leftScene) || before(leftScene, atDestination),
        warning('times', 'The trip times are out of order')
      );

const tripIssues = (c: ClaimCheck) =>
  transports(c)
    ? [
        ...when(
          !c.details.documentation.transportReason,
          blocking('transportReason', 'The ambulance transport reason is missing')
        ),
        ...timeIssues(c.details.documentation),
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

const FILING_WARNING_DAYS = 30;

const filingIssues = (c: ClaimCheck, asOf: Date) =>
  c.details.serviceDate
    ? c.payers.flatMap((p) => {
        const limit = filingLimitOf(p.claimFiling, p.filingLimitDays);
        if (limit === null || !c.details.serviceDate) return [];
        const left = limit - daysBetween(c.details.serviceDate, asOf.toISOString());
        return left < 0
          ? warning(
              'filing',
              `The ${limit}-day filing limit for ${p.name} passed ${-left} days ago; submit only with proof of timely filing`,
              p.coverageId
            )
          : when(
              left <= FILING_WARNING_DAYS,
              warning(
                'filing',
                `${left} days are left to file with ${p.name} (${limit}-day limit)`,
                p.coverageId
              )
            );
      })
    : [];

export const claimIssues = (c: ClaimCheck, asOf: Date | null = null): ClaimIssue[] => [
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
    warning(
      'emergency',
      'A scheduled trip is billed as an emergency; confirm the unit responded immediately'
    )
  ),
  ...lineIssues(c),
  ...when(
    !c.details.diagnoses.length,
    blocking('diagnoses', 'At least one diagnosis code is required')
  ),
  ...addressIssues('pickup', 'pickup', c.details.pickup),
  ...tripIssues(c),
  ...signatureIssues(c.details.documentation),
  ...pcsIssues(c),
  ...when(
    !c.payers.length,
    warning('payers', 'No payer is on the claim, so the patient is billed')
  ),
  ...when(
    c.payers.length > MAX_PAYERS,
    blocking('payers', `An 837P claim carries at most ${MAX_PAYERS} payers`)
  ),
  ...c.payers.flatMap(payerIssues),
  ...(asOf ? filingIssues(c, asOf) : [])
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
