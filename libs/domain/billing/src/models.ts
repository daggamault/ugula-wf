import { type Model, type ModelField, modelType, type ValueType } from '@ugula/graph';

const CATEGORY = 'Billing';

const X12 = 'X12 837P';

const f = (name: string, type: ValueType, label: string): ModelField => ({ name, type, label });

const model = (
  key: string,
  name: string,
  title: string,
  description: string,
  fields: ModelField[],
  category = CATEGORY
): Model & { type: ValueType } => ({
  key,
  name,
  title,
  category,
  description,
  fields,
  type: modelType({ fields })
});

const ADDRESS = [
  f('addressLine', 'string', 'Street address'),
  f('city', 'string', 'City'),
  f('state', 'string', 'State'),
  f('postalCode', 'string', 'ZIP code')
];

export const BLOB = { object: { bucket: 'string', key: 'string' } } as const satisfies ValueType;

const ADJUSTMENT_TYPE = {
  object: { group: 'string', reason: 'string', cents: 'integer' }
} as const satisfies ValueType;

export const DEMOGRAPHICS = model(
  'billing.demographics',
  'demographics',
  'Demographics',
  'the name, birth date, sex and address a patient is matched and created by',
  [
    f('firstName', 'string', 'First name'),
    f('lastName', 'string', 'Last name'),
    f('birthDate', 'string', 'Birth date (YYYY-MM-DD)'),
    f('gender', 'string', 'Sex (F, M or U)'),
    ...ADDRESS
  ]
);

export const PATIENT = model('billing.patient', 'patient', 'Patient', 'a billing patient', [
  f('id', 'string', 'Patient ID'),
  ...DEMOGRAPHICS.fields
]);

export const LOCATION = model(
  'billing.location',
  'location',
  'Location',
  'a named place such as a pickup or destination',
  [f('name', 'string', 'Name'), ...ADDRESS]
);

export const COVERAGE = model(
  'billing.coverage',
  'coverage',
  'Coverage',
  'one payer that covers a claim, and who holds the policy',
  [
    f('payer', 'string', 'Payer name as reported'),
    f('payerId', 'string', 'Directory payer ID'),
    f('directoryName', 'string', 'Directory payer name'),
    f('payerCode', 'string', 'Payer code'),
    f('priority', 'string', 'Billing priority'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID'),
    f('relationship', 'string', 'Patient relationship to the insured (X12 or NEMSIS code)'),
    f('insuredFirstName', 'string', 'Insured first name'),
    f('insuredLastName', 'string', 'Insured last name')
  ]
);

export const SERVICE = model(
  'billing.service',
  'service',
  'Service',
  'the level of service, emergency status and loaded miles of a trip, with the reasons',
  [
    f('level', 'string', 'Level of service (BLS, ALS1, ALS2, SCT)'),
    f('emergency', 'boolean', 'Emergency response'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('basis', { list: 'string' }, 'Reasons')
  ]
);

export const FINDINGS = model(
  'billing.findings',
  'findings',
  'Narrative Findings',
  'what the language model read in a PCR narrative',
  [
    f(
      'medications',
      { list: { object: { medication: 'string', route: 'string', doses: 'integer' } } },
      'Medication doses'
    ),
    f('procedures', { list: 'string' }, 'ALS2 procedures'),
    f('ivDoses', 'integer', 'IV/IO medication doses'),
    f('notes', { list: 'string' }, 'What limited the reading')
  ]
);

export const CLAIM_ISSUE = model(
  'billing.claim-issue',
  'issue',
  'Claim Issue',
  'something a claim is missing or that looks wrong, with the field it is fixed in',
  [
    f('level', 'string', 'Level (blocking or warning)'),
    f('field', 'string', 'Field to fix'),
    f('message', 'string', 'Message'),
    f('coverageId', 'string', 'Coverage it is about')
  ]
);

export const LINE = model('billing.line', 'line', 'Claim Line', 'one HCPCS charge line', [
  f('code', 'string', 'HCPCS code'),
  f('units', 'number', 'Units'),
  f('unitCents', 'integer', 'Unit price (cents)'),
  f('totalCents', 'integer', 'Line total (cents)')
]);

export const DOCUMENTATION = model(
  'billing.documentation',
  'documentation',
  'Documentation',
  'what the report documents for billing: signature, physician certification, transport reason, conditions, weight and trip times',
  [
    f('signature', 'string', 'Billing signature (signed, exception, refused or missing)'),
    f('signatureNote', 'string', 'Why the patient did not sign, or who signed'),
    f('pcsOnFile', 'boolean', 'Physician certification statement on file'),
    f('pcsSignedOn', 'string', 'Physician certification statement signed on (YYYY-MM-DD)'),
    f('transportReason', 'string', 'Ambulance transport reason (A to E)'),
    f('conditionCodes', { list: 'string' }, 'Ambulance condition codes'),
    f('priorAuthorization', 'string', 'Prior authorization number'),
    f('weightKg', 'number', 'Patient weight (kg)'),
    f('atScene', 'string', 'Arrived on scene'),
    f('leftScene', 'string', 'Left the scene'),
    f('atDestination', 'string', 'Arrived at the destination')
  ]
);

export const CLAIM = model('billing.claim', 'claim', 'Claim', 'a claim before it is saved', [
  f('pcrNumber', 'string', 'PCR number'),
  f('patientId', 'string', 'Patient ID'),
  f('tripType', 'string', 'Trip type'),
  f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)'),
  f('level', 'string', 'Level of service'),
  f('emergency', 'boolean', 'Emergency response'),
  f('loadedMiles', 'number', 'Loaded miles'),
  f('lines', { list: LINE.type }, 'Priced lines'),
  f('totalCents', 'integer', 'Total (cents)'),
  f('coverages', { list: COVERAGE.type }, 'Payers in billing order'),
  f('pickup', LOCATION.type, 'Pickup'),
  f('destination', LOCATION.type, 'Destination'),
  f('diagnoses', { list: 'string' }, 'ICD-10 diagnoses'),
  f('originDestination', 'string', 'Origin/destination modifier'),
  f('documentation', DOCUMENTATION.type, 'Documentation'),
  f('report', BLOB, 'Source report')
]);

const SUBMITTED_PATIENT = model(
  'billing.submitted-patient',
  'patient',
  'Submitted Patient',
  'the patient of a claim being submitted',
  [
    f('firstName', 'string', 'First name'),
    f('lastName', 'string', 'Last name'),
    f('birthDate', 'string', 'Birth date'),
    f('sex', 'string', 'Sex (F, M or U)'),
    ...ADDRESS
  ]
);

const PAYER_FIELDS = [
  f('name', 'string', 'Payer name'),
  f('payerId', 'string', 'Clearinghouse payer ID'),
  f('claimFiling', 'string', 'Claim filing indicator'),
  f('memberId', 'string', 'Member ID'),
  f('groupId', 'string', 'Group ID'),
  f('relationship', 'string', 'Patient relationship to the insured (X12)'),
  f('insuredFirstName', 'string', 'Insured first name'),
  f('insuredLastName', 'string', 'Insured last name')
];

const SUBMITTED_PAYER = model(
  'billing.submitted-payer',
  'payer',
  'Submitted Payer',
  'the payer a claim is being submitted to, with the policy holder',
  PAYER_FIELDS
);

const PRIOR_PAYER = model(
  'billing.prior-payer',
  'payer',
  'Prior Payer',
  'a payer that already adjudicated a claim, with what it paid and adjusted',
  [
    ...PAYER_FIELDS,
    f('paidCents', 'integer', 'Paid (cents)'),
    f('adjustedCents', 'integer', 'Adjusted (cents)'),
    f('paidOn', 'string', 'Adjudication date (YYYY-MM-DD)'),
    f('adjustments', { list: ADJUSTMENT_TYPE }, 'Adjustment reason codes')
  ]
);

const SUBMITTED_DETAILS = model(
  'billing.submitted-details',
  'details',
  'Submitted Trip',
  'the trip details of a claim being submitted',
  [
    f('serviceDate', 'string', 'Date of service'),
    f('pickup', LOCATION.type, 'Pickup'),
    f('destination', LOCATION.type, 'Destination'),
    f('diagnoses', { list: 'string' }, 'ICD-10 diagnoses'),
    f('originDestination', 'string', 'Origin/destination modifier'),
    f('documentation', DOCUMENTATION.type, 'Documentation')
  ]
);

const SUBMISSION = model(
  'billing.submission',
  'claim',
  'Claim to Submit',
  'a saved claim on its way to a payer',
  [
    f('claimId', 'string', 'Claim ID'),
    f('payerClaimNumber', 'string', 'Payer claim number of the claim it replaces'),
    f('payer', SUBMITTED_PAYER.type, 'Payer'),
    f('priorPayers', { list: PRIOR_PAYER.type }, 'Payers that already adjudicated it, in order'),
    f('patient', SUBMITTED_PATIENT.type, 'Patient'),
    f('details', SUBMITTED_DETAILS.type, 'Trip'),
    f('emergency', 'boolean', 'Emergency response'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('lines', { list: LINE.type }, 'Priced lines')
  ]
);

const X837_SUBSCRIBER = model(
  'x837.subscriber',
  'subscriber',
  'Subscriber',
  'the 837P subscriber loop (2010BA); a self subscriber is named after the patient when blank',
  [
    f('relationship', 'string', 'Patient relationship (SBR02, PAT01)'),
    f('lastName', 'string', 'Last name (NM103)'),
    f('firstName', 'string', 'First name (NM104)'),
    f('memberId', 'string', 'Member ID (NM109)'),
    f('groupId', 'string', 'Group number (SBR03)')
  ],
  X12
);

const X837_PATIENT = model(
  'x837.patient',
  'patient',
  'Patient',
  'the person transported: written in the subscriber loop when self, else the patient loop (2010CA)',
  [
    f('lastName', 'string', 'Last name (NM103)'),
    f('firstName', 'string', 'First name (NM104)'),
    ...ADDRESS,
    f('birthDate', 'string', 'Birth date (DMG02)'),
    f('sex', 'string', 'Sex (DMG03)')
  ],
  X12
);

const X837_PAYER = model(
  'x837.payer',
  'payer',
  'Payer',
  'the 837P payer loop (2010BB)',
  [
    f('name', 'string', 'Payer name (NM103)'),
    f('payerId', 'string', 'Payer ID (NM109)'),
    f('claimFiling', 'string', 'Claim filing indicator (SBR09)')
  ],
  X12
);

const X837_OTHER_PAYER = model(
  'x837.other-payer',
  'otherPayer',
  'Other Payer',
  'a payer that already adjudicated the claim (2320, 2330A, 2330B), in billing order',
  [
    f('name', 'string', 'Payer name (2330B NM103)'),
    f('payerId', 'string', 'Payer ID (2330B NM109)'),
    f('claimFiling', 'string', 'Claim filing indicator (SBR09)'),
    f('memberId', 'string', 'Member ID (2330A NM109)'),
    f('groupId', 'string', 'Group number (SBR03)'),
    f('relationship', 'string', 'Patient relationship (SBR02)'),
    f('lastName', 'string', 'Insured last name (2330A NM103)'),
    f('firstName', 'string', 'Insured first name (2330A NM104)'),
    f('paidCents', 'integer', 'Paid in cents (AMT02)'),
    f('adjustedCents', 'integer', 'Adjusted in cents, without reason codes (CAS)'),
    f('paidOn', 'string', 'Adjudication date (DTP03)'),
    f('adjustments', { list: ADJUSTMENT_TYPE }, 'Adjustment reason codes (CAS)')
  ],
  X12
);

const X837_LINE = model(
  'x837.line',
  'line',
  'Service Line',
  'one 837P service line (2400)',
  [
    f('code', 'string', 'HCPCS code (SV101-2)'),
    f('modifiers', { list: 'string' }, 'Modifiers (SV101-3 to 6)'),
    f('chargeCents', 'integer', 'Charge in cents (SV102)'),
    f('units', 'number', 'Units (SV104)'),
    f('serviceDate', 'string', 'Date of service (DTP03)')
  ],
  X12
);

export const X837_CLAIM = model(
  'x837.claim',
  'x837',
  '837P Claim',
  'one 837P claim (2300) with its subscriber, patient, payers and service lines',
  [
    f('claimId', 'string', 'Patient control number (CLM01)'),
    f('placeOfService', 'string', 'Place of service (CLM05-1)'),
    f('frequency', 'string', 'Claim frequency (CLM05-3)'),
    f('payerClaimNumber', 'string', 'Payer claim control number (REF F8)'),
    f('priorAuthorization', 'string', 'Prior authorization number (REF G1)'),
    f('subscriber', X837_SUBSCRIBER.type, 'Subscriber'),
    f('patient', X837_PATIENT.type, 'Patient'),
    f('payer', X837_PAYER.type, 'Payer'),
    f('otherPayers', { list: X837_OTHER_PAYER.type }, 'Other payers (2320)'),
    f('weightPounds', 'integer', 'Patient weight in pounds (CR102)'),
    f('transportReason', 'string', 'Transport reason (CR104), with loaded miles'),
    f('loadedMiles', 'number', 'Loaded miles (CR106), none without transport'),
    f('conditionCodes', { list: 'string' }, 'Ambulance conditions (CRC03 to 07)'),
    f('diagnoses', { list: 'string' }, 'Diagnoses (HI)'),
    f('pickup', LOCATION.type, 'Pickup (2310E)'),
    f('dropoff', LOCATION.type, 'Drop-off (2310F), with transport'),
    f('lines', { list: X837_LINE.type }, 'Service lines')
  ],
  X12
);

export const billingTypes = {
  blob: BLOB,
  demographics: DEMOGRAPHICS.type,
  patient: PATIENT.type,
  location: LOCATION.type,
  coverages: { list: COVERAGE.type },
  service: SERVICE.type,
  findings: FINDINGS.type,
  issues: { list: CLAIM_ISSUE.type },
  lines: { list: LINE.type },
  documentation: DOCUMENTATION.type,
  claim: CLAIM.type,
  submission: SUBMISSION.type,
  x837: X837_CLAIM.type
} satisfies Record<string, ValueType>;

export const billingModels: Model[] = [
  DEMOGRAPHICS,
  PATIENT,
  LOCATION,
  COVERAGE,
  SERVICE,
  FINDINGS,
  CLAIM_ISSUE,
  LINE,
  DOCUMENTATION,
  CLAIM,
  SUBMITTED_PATIENT,
  SUBMITTED_PAYER,
  PRIOR_PAYER,
  SUBMITTED_DETAILS,
  SUBMISSION,
  X837_SUBSCRIBER,
  X837_PATIENT,
  X837_PAYER,
  X837_OTHER_PAYER,
  X837_LINE,
  X837_CLAIM
].map(({ type: _, ...m }) => m);
