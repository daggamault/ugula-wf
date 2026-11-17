import { ADDRESS, f, model } from './model-kit.ts';

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
  f('id', { id: 'patient' }, 'Patient ID'),
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
    f('payerId', { id: 'payer' }, 'Directory payer ID'),
    f('directoryName', 'string', 'Directory payer name'),
    f('payerCode', 'string', 'Payer code'),
    f('priority', 'string', 'Billing priority'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID'),
    f('relationship', 'string', 'Patient relationship to the insured (X12 or NEMSIS code)'),
    f('insuredFirstName', 'string', 'Insured first name'),
    f('insuredLastName', 'string', 'Insured last name'),
    f('claimFiling', 'string', 'Claim filing indicator of the directory payer')
  ]
);

export const COVERAGE_CANDIDATE = model(
  'billing.coverage-candidate',
  'candidate',
  'Coverage Candidate',
  'a coverage insurance discovery found for the patient with a directory payer, not yet on the claim',
  [
    f('payerId', { id: 'payer' }, 'Directory payer ID'),
    f('payerName', 'string', 'Directory payer name'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID'),
    f('planName', 'string', 'Plan name the payer gave'),
    f(
      'entity',
      'string',
      'How the 271 named the payer: PR for the payer asked, PRP, SEP or TTP for the primary, secondary or tertiary payer it reported'
    )
  ]
);
