type ValueType =
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | { list: ValueType }
  | { object: Record<string, ValueType> };

export type ModelField = { name: string; type: ValueType; label: string };

export type Model = {
  key: string;
  name: string;
  title: string;
  category: string;
  description: string;
  fields: ModelField[];
};

const CATEGORY = 'Billing';

const X12 = 'X12 837P';

const f = (name: string, type: ValueType, label: string): ModelField => ({ name, type, label });

const objectOf = (fields: ModelField[]): ValueType => ({
  object: Object.fromEntries(fields.map((x) => [x.name, x.type]))
});

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
  type: objectOf(fields)
});

const ADDRESS = [
  f('addressLine', 'string', 'Street address'),
  f('city', 'string', 'City'),
  f('state', 'string', 'State'),
  f('postalCode', 'string', 'ZIP code')
];

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
  'one payer that covers a claim',
  [
    f('payer', 'string', 'Payer name as reported'),
    f('payerId', 'string', 'Directory payer ID'),
    f('directoryName', 'string', 'Directory payer name'),
    f('payerCode', 'string', 'Payer code'),
    f('priority', 'string', 'Billing priority'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID')
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
    f('ivDoses', 'integer', 'IV/IO medication doses')
  ]
);

export const LINE = model('billing.line', 'line', 'Claim Line', 'one HCPCS charge line', [
  f('code', 'string', 'HCPCS code'),
  f('units', 'number', 'Units'),
  f('unitCents', 'integer', 'Unit price (cents)'),
  f('totalCents', 'integer', 'Line total (cents)')
]);

const BLOB: ValueType = { object: { bucket: 'string', key: 'string' } };

export const CLAIM = model('billing.claim', 'claim', 'Claim', 'a claim before it is saved', [
  f('pcrNumber', 'string', 'PCR number'),
  f('patientId', 'string', 'Patient ID'),
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
  f('report', BLOB, 'Source report')
]);

export const SUBMITTED_PATIENT = model(
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

export const SUBMITTED_PAYER = model(
  'billing.submitted-payer',
  'payer',
  'Submitted Payer',
  'the payer a claim is being submitted to',
  [
    f('name', 'string', 'Payer name'),
    f('payerId', 'string', 'Clearinghouse payer ID'),
    f('claimFiling', 'string', 'Claim filing indicator')
  ]
);

export const SUBMITTED_DETAILS = model(
  'billing.submitted-details',
  'details',
  'Submitted Trip',
  'the trip details of a claim being submitted',
  [
    f('serviceDate', 'string', 'Date of service'),
    f('pickup', LOCATION.type, 'Pickup'),
    f('destination', LOCATION.type, 'Destination'),
    f('diagnoses', { list: 'string' }, 'ICD-10 diagnoses'),
    f('originDestination', 'string', 'Origin/destination modifier')
  ]
);

export const SUBMISSION = model(
  'billing.submission',
  'claim',
  'Claim to Submit',
  'a saved claim on its way to a payer',
  [
    f('claimId', 'string', 'Claim ID'),
    f('priorPayers', { list: 'string' }, 'Payers that already answered'),
    f('payer', SUBMITTED_PAYER.type, 'Payer'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID'),
    f('patient', SUBMITTED_PATIENT.type, 'Patient'),
    f('details', SUBMITTED_DETAILS.type, 'Trip'),
    f('emergency', 'boolean', 'Emergency response'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('lines', { list: LINE.type }, 'Priced lines')
  ]
);

export const X837_SUBSCRIBER = model(
  'x837.subscriber',
  'subscriber',
  'Subscriber',
  'the 837P subscriber loop (2010BA)',
  [
    f('relationship', 'string', 'Relationship code (SBR02)'),
    f('lastName', 'string', 'Last name (NM103)'),
    f('firstName', 'string', 'First name (NM104)'),
    f('memberId', 'string', 'Member ID (NM109)'),
    f('groupId', 'string', 'Group number (SBR03)'),
    ...ADDRESS,
    f('birthDate', 'string', 'Birth date (DMG02)'),
    f('sex', 'string', 'Sex (DMG03)')
  ],
  X12
);

export const X837_PAYER = model(
  'x837.payer',
  'payer',
  'Payer',
  'the 837P payer loop (2010BB)',
  [
    f('responsibility', 'string', 'Payer responsibility (SBR01)'),
    f('name', 'string', 'Payer name (NM103)'),
    f('payerId', 'string', 'Payer ID (NM109)'),
    f('claimFiling', 'string', 'Claim filing indicator (SBR09)')
  ],
  X12
);

export const X837_LINE = model(
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
  'one 837P claim (2300) with its subscriber, payer and service lines',
  [
    f('claimId', 'string', 'Patient control number (CLM01)'),
    f('placeOfService', 'string', 'Place of service (CLM05-1)'),
    f('frequency', 'string', 'Claim frequency (CLM05-3)'),
    f('subscriber', X837_SUBSCRIBER.type, 'Subscriber'),
    f('payer', X837_PAYER.type, 'Payer'),
    f('transportReason', 'string', 'Transport reason (CR104)'),
    f('loadedMiles', 'number', 'Loaded miles (CR106)'),
    f('conditionCodes', { list: 'string' }, 'Ambulance conditions (CRC03 to 07)'),
    f('diagnoses', { list: 'string' }, 'Diagnoses (HI)'),
    f('pickup', LOCATION.type, 'Pickup (2310E)'),
    f('dropoff', LOCATION.type, 'Drop-off (2310F)'),
    f('lines', { list: X837_LINE.type }, 'Service lines')
  ],
  X12
);

export const billingModels: Model[] = [
  DEMOGRAPHICS,
  PATIENT,
  LOCATION,
  COVERAGE,
  SERVICE,
  FINDINGS,
  LINE,
  CLAIM,
  SUBMITTED_PATIENT,
  SUBMITTED_PAYER,
  SUBMITTED_DETAILS,
  SUBMISSION,
  X837_SUBSCRIBER,
  X837_PAYER,
  X837_LINE,
  X837_CLAIM
].map(({ type: _, ...m }) => m);
