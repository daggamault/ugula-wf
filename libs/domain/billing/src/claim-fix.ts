import type { FieldSpec } from '@ugula/graph';
import {
  isServiceLevel,
  isTripType,
  MAX_LOADED_MILES,
  type PricedLine,
  SERVICE_LEVELS,
  type ServiceLevel,
  TRIP_TYPE_LABELS,
  TRIP_TYPES,
  type TripType
} from './charges.ts';
import {
  INSURED_RELATIONSHIPS,
  type InsuredRelationship,
  isOriginDestination,
  isRelationship,
  type Location,
  ORIGIN_DESTINATION_CODES,
  RELATIONSHIP_LABELS,
  readClaimDetails,
  SELF
} from './claim-details.ts';

import type { ClaimCheck, ClaimField, ClaimIssue } from './claim-validation.ts';
import {
  FACILITY_STAYS,
  type FacilityStay,
  facilityStayOf,
  isSignatureStatus,
  isTransportReason,
  MAX_DOCUMENTED_COUNT,
  MSP_ACCIDENTS,
  type MspAccident,
  mspAccidentOf,
  PCS_TYPES,
  type PcsType,
  pcsTypeOf,
  SIGNATURE_LABELS,
  SIGNATURE_STATUSES,
  type SignatureStatus,
  TRANSPORT_REASONS,
  type TransportReason
} from './documentation.ts';
import { type Address, readAddress } from './patients.ts';
import { type DirectoryPayer, payerDocument } from './payers.ts';
import { recordOf, textOrNull } from './values.ts';

const option = (value: string, label: string) => ({ value, label });

const ADDRESS_FIELDS = [
  ['AddressLine', 'street address'],
  ['City', 'city'],
  ['State', 'state'],
  ['PostalCode', 'ZIP code']
] as const;

const address = (prefix: string, label: string): FieldSpec[] =>
  ADDRESS_FIELDS.map(([part, name]) => ({
    name: `${prefix}${part}`,
    type: 'string',
    label: `${label} ${name}`
  }));

const MODIFIER_OPTIONS = Object.entries(ORIGIN_DESTINATION_CODES).map(([code, label]) =>
  option(code, `${code} · ${label}`)
);

export const TRIP_TYPE_FIELD: FieldSpec = {
  name: 'tripType',
  type: 'string',
  label: 'Trip type',
  options: TRIP_TYPES.filter((t) => t !== 'noClaim').map((t) => option(t, TRIP_TYPE_LABELS[t]))
};

export const LEVEL_FIELD: FieldSpec = {
  name: 'level',
  type: 'string',
  label: 'Level of service',
  options: SERVICE_LEVELS.map((l) => option(l, l === 'SCT' ? 'Specialty care transport' : l))
};

export const LOADED_MILES_FIELD: FieldSpec = {
  name: 'loadedMiles',
  type: 'number',
  label: 'Loaded miles',
  min: 0,
  max: MAX_LOADED_MILES
};

const choices = (labels: Readonly<Record<string, string>>) =>
  Object.entries(labels).map(([value, label]) => option(value, label));

const DECEASED_FIELD: FieldSpec = {
  name: 'deceased',
  type: 'boolean',
  label: 'Pronounced dead before loading (bill BLS with QL, no mileage)'
};

const NON_COVERED_MILES_FIELD: FieldSpec = {
  name: 'nonCoveredMiles',
  type: 'number',
  label: 'Non-covered miles beyond the nearest appropriate facility (A0888)',
  min: 0,
  max: MAX_LOADED_MILES
};

const DOCUMENTATION_FIX_FIELDS: FieldSpec[] = [
  {
    name: 'patientCount',
    type: 'integer',
    label: 'Patients transported on the trip',
    min: 1,
    max: MAX_DOCUMENTED_COUNT
  },
  { name: 'abnOnFile', type: 'boolean', label: 'Advance Beneficiary Notice (ABN) on file' },
  { name: 'abnSignedOn', type: 'string', label: 'ABN signed on', format: 'date' },
  { name: 'denialExpected', type: 'boolean', label: 'Medicare is expected to deny the transport' },
  {
    name: 'mspEmployerPlan',
    type: 'boolean',
    label: 'MSP: group health plan from the patient or spouse’s current employment'
  },
  {
    name: 'mspEsrd',
    type: 'boolean',
    label: 'MSP: end-stage renal disease, in the 30-month coordination period'
  },
  {
    name: 'mspDisability',
    type: 'boolean',
    label: 'MSP: under 65 and disabled, with a large group health plan'
  },
  {
    name: 'mspAccident',
    type: 'string',
    label: 'MSP: accident or work injury',
    options: choices(MSP_ACCIDENTS)
  },
  { name: 'priorAuthorization', type: 'string', label: 'Prior authorization number (UTN)' },
  {
    name: 'priorAuthorizationExpiresOn',
    type: 'string',
    label: 'Prior authorization expires on',
    format: 'date'
  },
  {
    name: 'pcsType',
    type: 'string',
    label: 'Physician certification type',
    options: choices(PCS_TYPES)
  },
  {
    name: 'roundTrips',
    type: 'integer',
    label: 'Round trips in this repetitive series, including this one',
    min: 0,
    max: MAX_DOCUMENTED_COUNT
  },
  { name: 'admissionDate', type: 'string', label: 'Admission date', format: 'date' },
  {
    name: 'facilityStay',
    type: 'string',
    label: 'Facility stay during the transport',
    options: choices(FACILITY_STAYS)
  }
];

export const CLAIM_FIX_FIELDS: FieldSpec[] = [
  {
    name: 'serviceDate',
    type: 'string',
    label: 'Date of service',
    format: 'date',
    required: ['save']
  },
  TRIP_TYPE_FIELD,
  LEVEL_FIELD,
  { name: 'emergency', type: 'boolean', label: 'Emergency response' },
  LOADED_MILES_FIELD,
  DECEASED_FIELD,
  NON_COVERED_MILES_FIELD,
  {
    name: 'diagnoses',
    type: { list: 'string' },
    label: 'ICD-10 diagnoses, primary first',
    required: ['save']
  },
  ...address('pickup', 'Pickup'),
  { name: 'destinationName', type: 'string', label: 'Destination name' },
  ...address('destination', 'Destination'),
  {
    name: 'originCode',
    type: 'string',
    label: 'Origin modifier',
    options: MODIFIER_OPTIONS.filter((o) => o.value !== 'X')
  },
  {
    name: 'destinationCode',
    type: 'string',
    label: 'Destination modifier',
    options: MODIFIER_OPTIONS
  },
  {
    name: 'transportReason',
    type: 'string',
    label: 'Ambulance transport reason',
    options: Object.entries(TRANSPORT_REASONS).map(([code, label]) =>
      option(code, `${code} · ${label}`)
    )
  },
  {
    name: 'signature',
    type: 'string',
    label: 'Billing signature',
    options: SIGNATURE_STATUSES.map((s) => option(s, SIGNATURE_LABELS[s]))
  },
  { name: 'pcsOnFile', type: 'boolean', label: 'Physician certification statement on file' },
  {
    name: 'pcsSignedOn',
    type: 'string',
    label: 'Physician certification statement signed on',
    format: 'date'
  },
  ...DOCUMENTATION_FIX_FIELDS,
  ...address('patient', 'Patient'),
  { name: 'coverageId', type: 'string', label: 'Payer on the claim' },
  { name: 'payerId', type: 'string', label: 'Directory payer' },
  { name: 'memberId', type: 'string', label: 'Member ID' },
  {
    name: 'relationship',
    type: 'string',
    label: 'Patient relationship to the insured',
    options: INSURED_RELATIONSHIPS.map((r) => option(r, RELATIONSHIP_LABELS[r]))
  },
  { name: 'insuredFirstName', type: 'string', label: 'Insured first name' },
  { name: 'insuredLastName', type: 'string', label: 'Insured last name' },
  { name: 'removeCoverage', type: 'boolean', label: 'Remove this payer from the claim' },
  { name: 'note', type: 'string', label: 'Note' }
];

const COVERAGE_FIELDS = [
  'coverageId',
  'payerId',
  'memberId',
  'relationship',
  'insuredFirstName',
  'insuredLastName',
  'removeCoverage'
];

const CHARGE_FIELDS = [
  'tripType',
  'level',
  'emergency',
  'loadedMiles',
  'deceased',
  'nonCoveredMiles'
];

const names = (prefix: string) => ADDRESS_FIELDS.map(([part]) => `${prefix}${part}`);

const FIELDS_OF: Record<ClaimField, string[]> = {
  patient: [],
  pcrNumber: [],
  patientAddress: names('patient'),
  serviceDate: ['serviceDate'],
  tripType: CHARGE_FIELDS,
  level: CHARGE_FIELDS,
  emergency: CHARGE_FIELDS,
  loadedMiles: CHARGE_FIELDS,
  lines: CHARGE_FIELDS,
  diagnoses: ['diagnoses'],
  pickup: names('pickup'),
  destination: ['destinationName', ...names('destination')],
  originDestination: ['originCode', 'destinationCode'],
  payers: COVERAGE_FIELDS,
  payer: COVERAGE_FIELDS,
  memberId: COVERAGE_FIELDS,
  insured: COVERAGE_FIELDS,
  signature: ['signature'],
  pcs: ['pcsOnFile', 'pcsSignedOn', 'pcsType'],
  transportReason: ['transportReason'],
  times: [],
  filing: [],
  submission: [],
  deceased: CHARGE_FIELDS,
  nonCoveredMiles: CHARGE_FIELDS,
  patientCount: ['patientCount'],
  abn: ['abnOnFile', 'abnSignedOn', 'denialExpected'],
  msp: ['mspEmployerPlan', 'mspEsrd', 'mspDisability', 'mspAccident'],
  priorAuthorization: [
    'priorAuthorization',
    'priorAuthorizationExpiresOn',
    'pcsType',
    'roundTrips'
  ],
  facility: ['facilityStay', 'admissionDate']
};

type FixForm = {
  visible: string[];
  defaults: Record<string, unknown>;
  options: Record<string, { value: string; label: string }[]>;
};

const locationDefaults = (prefix: string, l: Address) => ({
  [`${prefix}AddressLine`]: l.addressLine,
  [`${prefix}City`]: l.city,
  [`${prefix}State`]: l.state,
  [`${prefix}PostalCode`]: l.postalCode
});

export const fixForm = (
  check: ClaimCheck,
  issues: readonly ClaimIssue[],
  directory: readonly DirectoryPayer[],
  all: boolean
): FixForm => {
  const coverageId =
    issues.find((i) => i.coverageId !== null)?.coverageId ?? check.payers[0]?.coverageId ?? null;
  const payer = check.payers.find((p) => p.coverageId === coverageId) ?? null;
  const asked = new Set(
    all
      ? CLAIM_FIX_FIELDS.map((f) => f.name)
      : [...issues.flatMap((i) => FIELDS_OF[i.field]), 'note']
  );
  if (!check.payers.length) for (const f of COVERAGE_FIELDS) asked.delete(f);
  if (!directory.length) asked.delete('payerId');
  const od = check.details.originDestination;
  const doc = check.details.documentation;
  return {
    visible: CLAIM_FIX_FIELDS.map((f) => f.name).filter((n) => asked.has(n)),
    defaults: {
      serviceDate: check.details.serviceDate,
      tripType: check.tripType === 'noClaim' ? null : check.tripType,
      level: check.level,
      emergency: check.emergency,
      loadedMiles: check.loadedMiles,
      deceased: check.deceased,
      nonCoveredMiles: check.nonCoveredMiles,
      diagnoses: check.details.diagnoses,
      ...locationDefaults('pickup', check.details.pickup),
      destinationName: check.details.destination.name,
      ...locationDefaults('destination', check.details.destination),
      originCode: od?.[0] ?? null,
      destinationCode: od?.[1] ?? null,
      transportReason: doc.transportReason,
      signature: doc.signature,
      pcsOnFile: doc.pcsOnFile,
      pcsSignedOn: doc.pcsSignedOn,
      ...Object.fromEntries(
        DOCUMENTATION_FIX_FIELDS.map((f) => [f.name, doc[f.name as keyof typeof doc]])
      ),
      ...(check.patient ? locationDefaults('patient', check.patient) : {}),
      coverageId,
      payerId: payer?.payerId ?? null,
      memberId: payer?.memberId ?? null,
      relationship: payer?.relationship ?? null,
      insuredFirstName: payer?.insuredFirstName ?? null,
      insuredLastName: payer?.insuredLastName ?? null,
      removeCoverage: false
    },
    options: {
      ...(check.payers.length
        ? {
            coverageId: check.payers.flatMap((p) =>
              p.coverageId
                ? [option(p.coverageId, p.memberId ? `${p.name} · ${p.memberId}` : p.name)]
                : []
            )
          }
        : {}),
      ...(directory.length ? { payerId: directory.map((p) => option(p.id, payerDocument(p))) } : {})
    }
  };
};

export type CoveragePatch = {
  coverageId: string;
  payerId: string | null;
  memberId: string | null;
  relationship: InsuredRelationship | null;
  insuredFirstName: string | null;
  insuredLastName: string | null;
  remove: boolean;
};

type NewCoverage = {
  payerId: string;
  memberId: string | null;
  relationship: InsuredRelationship;
  insuredFirstName: string | null;
  insuredLastName: string | null;
};

export type DocumentationPatch = {
  signature: SignatureStatus | null;
  pcsOnFile: boolean | null;
  pcsSignedOn: string | null;
  transportReason: TransportReason | null;
  patientCount: number | null;
  abnOnFile: boolean | null;
  abnSignedOn: string | null;
  denialExpected: boolean | null;
  mspEmployerPlan: boolean | null;
  mspEsrd: boolean | null;
  mspDisability: boolean | null;
  mspAccident: MspAccident | null;
  priorAuthorization: string | null;
  priorAuthorizationExpiresOn: string | null;
  pcsType: PcsType | null;
  roundTrips: number | null;
  admissionDate: string | null;
  facilityStay: FacilityStay | null;
};

export type ClaimPatch = {
  serviceDate: string | null;
  tripType: TripType | null;
  level: ServiceLevel | null;
  emergency: boolean | null;
  loadedMiles: number | null;
  deceased: boolean | null;
  nonCoveredMiles: number | null;
  diagnoses: string[] | null;
  pickup: Location | null;
  destination: Location | null;
  originDestination: string | null;
  documentation: DocumentationPatch | null;
  patientAddress: Address | null;
  coverage: CoveragePatch | null;
  newCoverage: NewCoverage | null;
  lines: PricedLine[] | null;
  note: string | null;
};

const changedAddress = (r: Record<string, unknown>, prefix: string, current: Address) => {
  const given = ADDRESS_FIELDS.some(([part]) => textOrNull(r[`${prefix}${part}`]) !== null);
  if (!given) return null;
  const pick = (part: string, now: string | null) => textOrNull(r[`${prefix}${part}`]) ?? now;
  return readAddress({
    addressLine: pick('AddressLine', current.addressLine),
    city: pick('City', current.city),
    state: pick('State', current.state),
    postalCode: pick('PostalCode', current.postalCode)
  });
};

const coveragePatch = (r: Record<string, unknown>, check: ClaimCheck): CoveragePatch | null => {
  const coverageId = textOrNull(r.coverageId);
  if (!coverageId || !check.payers.some((p) => p.coverageId === coverageId)) return null;
  const patch = {
    coverageId,
    payerId: textOrNull(r.payerId),
    memberId: textOrNull(r.memberId),
    relationship: isRelationship(r.relationship) ? r.relationship : null,
    insuredFirstName: textOrNull(r.insuredFirstName),
    insuredLastName: textOrNull(r.insuredLastName),
    remove: r.removeCoverage === true
  };
  const { coverageId: _, remove, ...values } = patch;
  return remove || Object.values(values).some((v) => v !== null) ? patch : null;
};

const newCoverage = (r: Record<string, unknown>, check: ClaimCheck): NewCoverage | null => {
  const payerId = textOrNull(r.payerId);
  return payerId && !textOrNull(r.coverageId) && !check.payers.length
    ? {
        payerId,
        memberId: textOrNull(r.memberId),
        relationship: isRelationship(r.relationship) ? r.relationship : SELF,
        insuredFirstName: textOrNull(r.insuredFirstName),
        insuredLastName: textOrNull(r.insuredLastName)
      }
    : null;
};

const modifier = (r: Record<string, unknown>, current: string | null) => {
  const code = `${textOrNull(r.originCode) ?? current?.[0] ?? ''}${textOrNull(r.destinationCode) ?? current?.[1] ?? ''}`;
  return code !== current && isOriginDestination(code) ? code : null;
};

const dateIn = (x: unknown) => readClaimDetails({ serviceDate: x }).serviceDate;

const flagIn = (x: unknown) => (typeof x === 'boolean' ? x : null);

const countIn = (x: unknown, min: number) =>
  typeof x === 'number' && Number.isInteger(x) && x >= min && x <= MAX_DOCUMENTED_COUNT ? x : null;

const milesIn = (x: unknown) =>
  typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= MAX_LOADED_MILES ? x : null;

const documentationPatch = (
  r: Record<string, unknown>,
  check: ClaimCheck
): DocumentationPatch | null => {
  const now = check.details.documentation;
  const reason = textOrNull(r.transportReason)?.toUpperCase();
  const given: DocumentationPatch = {
    signature: isSignatureStatus(r.signature) ? r.signature : null,
    pcsOnFile: flagIn(r.pcsOnFile),
    pcsSignedOn: dateIn(r.pcsSignedOn),
    transportReason: isTransportReason(reason) ? reason : null,
    patientCount: countIn(r.patientCount, 1),
    abnOnFile: flagIn(r.abnOnFile),
    abnSignedOn: dateIn(r.abnSignedOn),
    denialExpected: flagIn(r.denialExpected),
    mspEmployerPlan: flagIn(r.mspEmployerPlan),
    mspEsrd: flagIn(r.mspEsrd),
    mspDisability: flagIn(r.mspDisability),
    mspAccident: mspAccidentOf(r.mspAccident),
    priorAuthorization: textOrNull(r.priorAuthorization),
    priorAuthorizationExpiresOn: dateIn(r.priorAuthorizationExpiresOn),
    pcsType: pcsTypeOf(r.pcsType),
    roundTrips: countIn(r.roundTrips, 0),
    admissionDate: dateIn(r.admissionDate),
    facilityStay: facilityStayOf(r.facilityStay)
  };
  const patch = Object.fromEntries(
    Object.entries(given).map(([k, v]) => [k, v !== now[k as keyof DocumentationPatch] ? v : null])
  ) as DocumentationPatch;
  return Object.values(patch).some((v) => v !== null) ? patch : null;
};

export const readClaimPatch = (values: unknown, check: ClaimCheck): ClaimPatch => {
  const r = recordOf(values);
  const details = readClaimDetails({ serviceDate: r.serviceDate, diagnoses: r.diagnoses });
  const pickup = changedAddress(r, 'pickup', check.details.pickup);
  const destination = changedAddress(r, 'destination', check.details.destination);
  const destinationName = textOrNull(r.destinationName);
  const miles = milesIn(r.loadedMiles);
  const nonCovered = milesIn(r.nonCoveredMiles);
  return {
    serviceDate: details.serviceDate,
    tripType: isTripType(r.tripType) && r.tripType !== 'noClaim' ? r.tripType : null,
    level: isServiceLevel(r.level) ? r.level : null,
    emergency: typeof r.emergency === 'boolean' ? r.emergency : null,
    loadedMiles: miles,
    deceased: typeof r.deceased === 'boolean' && r.deceased !== check.deceased ? r.deceased : null,
    nonCoveredMiles:
      nonCovered !== null && nonCovered !== (check.nonCoveredMiles ?? 0) ? nonCovered : null,
    diagnoses: Array.isArray(r.diagnoses) && details.diagnoses.length ? details.diagnoses : null,
    pickup: pickup && { name: check.details.pickup.name, ...pickup },
    destination:
      destination || destinationName
        ? {
            name: destinationName ?? check.details.destination.name,
            ...(destination ?? check.details.destination)
          }
        : null,
    originDestination: modifier(r, check.details.originDestination),
    documentation: documentationPatch(r, check),
    patientAddress: check.patient ? changedAddress(r, 'patient', check.patient) : null,
    coverage: coveragePatch(r, check),
    newCoverage: newCoverage(r, check),
    lines: null,
    note: textOrNull(r.note)
  };
};

export const chargeChanges = (p: ClaimPatch) => ({
  tripType: p.tripType !== null,
  level: p.level !== null,
  emergency: p.emergency !== null,
  loadedMiles: p.loadedMiles !== null,
  deceased: p.deceased !== null,
  nonCoveredMiles: p.nonCoveredMiles !== null,
  payers: p.coverage !== null || p.newCoverage !== null
});
