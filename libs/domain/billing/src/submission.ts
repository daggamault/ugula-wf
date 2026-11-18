import type { Adjudication } from './adjudications.ts';
import { type InsuredRelationship, SELF } from './claim-details.ts';
import type { ClaimLocation } from './claims.ts';
import type { Address, Sex } from './patients.ts';
import { type CoverageStatus, currentPayerIndex, isAdjudicated } from './payer-cycle.ts';
import { type Submitter, submitterIssues, type X837Claim } from './x837.ts';

type DirectoryEntry = { name: string; payerCode: string; claimFiling: string };

export type SubmissionCoverage = {
  payerName: string;
  payer: DirectoryEntry | null;
  memberId: string | null;
  groupId: string | null;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
  status: CoverageStatus;
  adjudication: Adjudication | null;
};

type SubmissionLine = {
  code: string;
  modifiers: string[];
  units: number;
  totalCents: number;
};

export type ClaimSubmission = {
  number: string;
  serviceDate: string | null;
  loadedMiles: number | null;
  transportReason: string | null;
  conditionCodes: string[];
  weightPounds: number | null;
  patient: Address & { firstName: string; lastName: string; birthDate: string; sex: Sex | null };
  pickup: ClaimLocation;
  destination: ClaimLocation;
  priorAuthorization: string | null;
  signatureOnFile: boolean;
  note: string | null;
  diagnoses: string[];
  coverages: SubmissionCoverage[];
  lines: SubmissionLine[];
};

const GROUND = '41';

const AIR = '42';

const AIR_CODES: readonly string[] = ['A0430', 'A0431', 'A0435', 'A0436'];

const ADDRESS_PARTS = [
  ['line', 'street'],
  ['city', 'city'],
  ['state', 'state'],
  ['postalCode', 'ZIP code']
] as const;

const missingParts = (a: Omit<ClaimLocation, 'name'>) =>
  ADDRESS_PARTS.flatMap(([key, label]) => (a[key] ? [] : [label]));

const words = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} or ${items.at(-1)}`;

const addressIssue = (what: string, a: Omit<ClaimLocation, 'name'>) => {
  const missing = missingParts(a);
  return missing.length ? [`${what} has no ${words(missing)}`] : [];
};

const patientIssues = (c: ClaimSubmission) =>
  addressIssue('The patient address', {
    line: c.patient.addressLine,
    city: c.patient.city,
    state: c.patient.state,
    postalCode: c.patient.postalCode
  });

const payerName = (c: SubmissionCoverage, i: number) => `Payer ${i + 1}, ${c.payerName},`;

const coverageIssues = (c: SubmissionCoverage, i: number) => [
  ...(c.payer
    ? []
    : [
        `${payerName(c, i)} is not in the payer directory: add it there, or choose a directory payer on the claim`
      ]),
  ...(c.memberId ? [] : [`${payerName(c, i)} has no member ID`]),
  ...(c.relationship !== SELF && !c.insuredLastName
    ? [`${payerName(c, i)} has no insured name, and the patient is not the insured`]
    : [])
];

const lineIssues = (lines: readonly SubmissionLine[]) =>
  lines.length
    ? lines.flatMap((l, i) =>
        l.totalCents > 0
          ? []
          : [`Line ${i + 1} (${l.code}) has no price: add a fee for it, then edit the claim`]
      )
    : ['The claim has no charge lines'];

const loadedMiles = (c: ClaimSubmission) =>
  c.loadedMiles !== null && c.loadedMiles > 0 ? c.loadedMiles : null;

const transported = (c: ClaimSubmission) => loadedMiles(c) !== null;

const priorPayers = (c: ClaimSubmission, current: number) =>
  c.coverages.slice(0, current).filter((p) => isAdjudicated(p.status));

export const isSelfPay = (c: Pick<ClaimSubmission, 'coverages'>) => c.coverages.length === 0;

export const submissionIssues = (c: ClaimSubmission, submitter: Submitter | null): string[] => {
  const current = currentPayerIndex(c.coverages);
  const payer = c.coverages[current];
  if (!payer) return patientIssues(c);
  return [
    ...submitterIssues(submitter),
    ...(c.serviceDate ? [] : ['The claim has no date of service']),
    ...(c.diagnoses.length ? [] : ['The claim has no diagnosis']),
    ...lineIssues(c.lines),
    ...c.coverages
      .slice(0, current + 1)
      .flatMap((p, i) => (i === current || isAdjudicated(p.status) ? coverageIssues(p, i) : [])),
    ...patientIssues(c),
    ...addressIssue('The pickup location', c.pickup),
    ...(transported(c)
      ? [
          ...addressIssue('The destination', c.destination),
          ...(c.transportReason ? [] : ['A transport needs a transport reason (CR1)'])
        ]
      : [])
  ];
};

const location = (l: ClaimLocation) => ({
  name: l.name,
  addressLine: l.line,
  city: l.city,
  state: l.state,
  postalCode: l.postalCode
});

const insuredOf = (p: SubmissionCoverage, c: ClaimSubmission) => ({
  lastName: p.insuredLastName ?? c.patient.lastName,
  firstName: p.insuredLastName ? p.insuredFirstName : c.patient.firstName
});

const notReady = (c: ClaimSubmission) => new Error(`Claim ${c.number} is not ready to send`);

const otherPayerOf = (c: ClaimSubmission) => (p: SubmissionCoverage) => {
  if (!p.payer || !p.memberId || !p.adjudication) throw notReady(c);
  return {
    name: p.payer.name,
    payerId: p.payer.payerCode,
    claimFiling: p.payer.claimFiling,
    memberId: p.memberId,
    groupId: p.groupId,
    relationship: p.relationship,
    ...insuredOf(p, c),
    ...p.adjudication
  };
};

export const x837ClaimOf = (c: ClaimSubmission): X837Claim => {
  const current = currentPayerIndex(c.coverages);
  const billed = c.coverages[current];
  const payer = billed?.payer;
  if (!billed || !payer || !billed.memberId || !c.serviceDate) throw notReady(c);
  const serviceDate = c.serviceDate;
  return {
    claimId: c.number,
    placeOfService: c.lines.some((l) => AIR_CODES.includes(l.code)) ? AIR : GROUND,
    frequency: '1',
    benefitsAssignment: c.signatureOnFile ? 'Y' : 'N',
    admissionDate: null,
    payerClaimNumber: null,
    priorAuthorization: c.priorAuthorization,
    note: c.note,
    subscriber: {
      relationship: billed.relationship,
      ...insuredOf(billed, c),
      memberId: billed.memberId,
      groupId: billed.groupId
    },
    patient: {
      lastName: c.patient.lastName,
      firstName: c.patient.firstName,
      birthDate: c.patient.birthDate,
      sex: c.patient.sex ?? 'U',
      addressLine: c.patient.addressLine,
      city: c.patient.city,
      state: c.patient.state,
      postalCode: c.patient.postalCode
    },
    payer: {
      name: payer.name,
      payerId: payer.payerCode,
      claimFiling: payer.claimFiling,
      insuranceType: null
    },
    otherPayers: priorPayers(c, current).map(otherPayerOf(c)),
    weightPounds: c.weightPounds,
    transportReason: c.transportReason,
    loadedMiles: loadedMiles(c),
    conditionCodes: c.conditionCodes,
    diagnoses: c.diagnoses,
    pickup: location(c.pickup),
    dropoff: location(c.destination),
    lines: c.lines.map((l) => ({
      code: l.code,
      modifiers: l.modifiers,
      chargeCents: l.totalCents,
      units: l.units,
      serviceDate,
      patientCount: null
    }))
  };
};
