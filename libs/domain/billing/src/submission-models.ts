import { DOCUMENTATION, LINE } from './claim-models.ts';
import { ADDRESS, ADJUSTMENT_TYPE, f, model, X12 } from './model-kit.ts';
import { LOCATION } from './party-models.ts';

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

export const SUBMITTED_PAYER = model(
  'billing.submitted-payer',
  'payer',
  'Submitted Payer',
  'the payer a claim is being submitted to, with the policy holder',
  PAYER_FIELDS
);

export const PRIOR_PAYER = model(
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
    f('originDestination', 'string', 'Origin/destination modifier'),
    f('documentation', DOCUMENTATION.type, 'Documentation')
  ]
);

export const SUBMISSION = model(
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
    f('deceased', 'boolean', 'Pronounced dead before loading (QL)'),
    f('lines', { list: LINE.type }, 'Priced lines')
  ]
);

export const X837_SUBSCRIBER = model(
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

export const X837_PATIENT = model(
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

export const X837_PAYER = model(
  'x837.payer',
  'payer',
  'Payer',
  'the 837P payer loop (2010BB)',
  [
    f('name', 'string', 'Payer name (NM103)'),
    f('payerId', 'string', 'Payer ID (NM109)'),
    f('claimFiling', 'string', 'Claim filing indicator (SBR09)'),
    f('insuranceType', 'string', 'Medicare secondary payer type (SBR05)')
  ],
  X12
);

export const X837_OTHER_PAYER = model(
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
  'one 837P claim (2300) with its subscriber, patient, payers and service lines',
  [
    f('claimId', 'string', 'Patient control number (CLM01)'),
    f('placeOfService', 'string', 'Place of service (CLM05-1)'),
    f('frequency', 'string', 'Claim frequency (CLM05-3)'),
    f('admissionDate', 'string', 'Admission date (DTP 435)'),
    f('payerClaimNumber', 'string', 'Payer claim control number (REF F8)'),
    f('priorAuthorization', 'string', 'Prior authorization number (REF G1)'),
    f('note', 'string', 'Claim note, at most 80 characters (NTE ADD)'),
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
