import type { FieldSpec } from '@ugula/graph';
import {
  CLASSIFICATION_LABELS,
  CLASSIFICATIONS,
  MAX_LOADED_MILES,
  SERVICE_LEVELS
} from './charges.ts';
import {
  INSURED_RELATIONSHIPS,
  ORIGIN_DESTINATION_CODES,
  RELATIONSHIP_LABELS
} from './claim-details.ts';

import type { ClaimField } from './claim-validation.ts';
import {
  FACILITY_STAYS,
  MAX_DOCUMENTED_COUNT,
  MSP_ACCIDENTS,
  PCS_TYPES,
  SIGNATURE_LABELS,
  SIGNATURE_STATUSES,
  TRANSPORT_REASONS
} from './documentation.ts';

export const option = (value: string, label: string) => ({ value, label });

export const ADDRESS_FIELDS = [
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

export const CLASSIFICATION_FIELD: FieldSpec = {
  name: 'classification',
  type: 'string',
  label: 'Classification',
  options: CLASSIFICATIONS.filter((t) => t !== 'notBillable').map((t) =>
    option(t, CLASSIFICATION_LABELS[t])
  )
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

export const DOCUMENTATION_FIX_FIELDS: FieldSpec[] = [
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
  CLASSIFICATION_FIELD,
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

export const COVERAGE_FIELDS = [
  'coverageId',
  'payerId',
  'memberId',
  'relationship',
  'insuredFirstName',
  'insuredLastName',
  'removeCoverage'
];

const CHARGE_FIELDS = [
  'classification',
  'level',
  'emergency',
  'loadedMiles',
  'deceased',
  'nonCoveredMiles'
];

const names = (prefix: string) => ADDRESS_FIELDS.map(([part]) => `${prefix}${part}`);

export const FIELDS_OF: Record<ClaimField, string[]> = {
  patient: [],
  pcrNumber: [],
  patientAddress: names('patient'),
  serviceDate: ['serviceDate'],
  classification: CHARGE_FIELDS,
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
