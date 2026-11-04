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
  isSignatureStatus,
  isTransportReason,
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

const CHARGE_FIELDS = ['tripType', 'level', 'emergency', 'loadedMiles'];

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
  pcs: ['pcsOnFile', 'pcsSignedOn'],
  transportReason: ['transportReason'],
  times: [],
  filing: [],
  submission: []
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

type DocumentationPatch = {
  signature: SignatureStatus | null;
  pcsOnFile: boolean | null;
  pcsSignedOn: string | null;
  transportReason: TransportReason | null;
};

export type ClaimPatch = {
  serviceDate: string | null;
  tripType: TripType | null;
  level: ServiceLevel | null;
  emergency: boolean | null;
  loadedMiles: number | null;
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

const documentationPatch = (
  r: Record<string, unknown>,
  check: ClaimCheck
): DocumentationPatch | null => {
  const now = check.details.documentation;
  const signedOn = readClaimDetails({ serviceDate: r.pcsSignedOn }).serviceDate;
  const reason = textOrNull(r.transportReason)?.toUpperCase();
  const patch = {
    signature: isSignatureStatus(r.signature) && r.signature !== now.signature ? r.signature : null,
    pcsOnFile:
      typeof r.pcsOnFile === 'boolean' && r.pcsOnFile !== now.pcsOnFile ? r.pcsOnFile : null,
    pcsSignedOn: signedOn !== now.pcsSignedOn ? signedOn : null,
    transportReason: isTransportReason(reason) && reason !== now.transportReason ? reason : null
  };
  return Object.values(patch).some((v) => v !== null) ? patch : null;
};

export const readClaimPatch = (values: unknown, check: ClaimCheck): ClaimPatch => {
  const r = recordOf(values);
  const details = readClaimDetails({ serviceDate: r.serviceDate, diagnoses: r.diagnoses });
  const pickup = changedAddress(r, 'pickup', check.details.pickup);
  const destination = changedAddress(r, 'destination', check.details.destination);
  const destinationName = textOrNull(r.destinationName);
  const miles = r.loadedMiles;
  return {
    serviceDate: details.serviceDate,
    tripType: isTripType(r.tripType) && r.tripType !== 'noClaim' ? r.tripType : null,
    level: isServiceLevel(r.level) ? r.level : null,
    emergency: typeof r.emergency === 'boolean' ? r.emergency : null,
    loadedMiles:
      typeof miles === 'number' && Number.isFinite(miles) && miles >= 0 && miles <= MAX_LOADED_MILES
        ? miles
        : null,
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

export const changesCharges = (p: ClaimPatch) =>
  [p.tripType, p.level, p.emergency, p.loadedMiles].some((x) => x !== null) ||
  p.coverage !== null ||
  p.newCoverage !== null;
