import { type Model, type ModelField, modelType, type ValueType } from '@ugula/graph';

const CATEGORY = 'Claim';

const f = (name: string, type: ValueType, label: string, description: string): ModelField => ({
  name,
  type,
  label,
  description
});

const model = (
  key: string,
  name: string,
  title: string,
  description: string,
  fields: ModelField[]
): Model => ({ key, name, title, category: CATEGORY, description, fields });

export const CHARGE_LINE = model(
  'charge-line',
  'line',
  'Charge Line',
  'one charge on a claim: the HCPCS code, its modifiers, units and price',
  [
    f('code', { code: 'hcpcs' }, 'HCPCS Code', 'The HCPCS code charged.'),
    f('modifiers', { list: { code: 'modifier' } }, 'Modifiers', 'Up to four modifiers, in order.'),
    f('units', 'number', 'Units', 'Loaded miles for mileage, 1 for anything else.'),
    f('unitCents', 'integer', 'Unit Price', 'The price of one unit, in cents.'),
    f('totalCents', 'integer', 'Line Total', 'The price of the line, in cents.')
  ]
);

export const COVERAGE = model(
  'coverage',
  'coverage',
  'Coverage',
  'one payer billed for a claim, and who holds the policy',
  [
    f('payerId', { id: 'payer' }, 'Payer', 'The payer in the directory, when one matched.'),
    f(
      'payerName',
      'string',
      'Payer Name',
      'The payer name as reported, kept when no directory payer matched.'
    ),
    f('memberId', 'string', 'Member ID', 'The member ID on the policy.'),
    f('groupId', 'string', 'Group ID', 'The group ID on the policy.'),
    f(
      'relationship',
      { code: 'x12Relationship' },
      'Relationship to the Insured',
      'The X12 code of how the patient is related to the insured, 18 for self.'
    ),
    f('insuredFirstName', 'string', 'Insured First Name', 'The first name of the insured.'),
    f('insuredLastName', 'string', 'Insured Last Name', 'The last name of the insured.')
  ]
);

export const CLAIM = model(
  'claim',
  'claim',
  'Claim',
  'a claim for one encounter: what was done, who pays and what it costs',
  [
    f('encounterId', { id: 'encounter' }, 'Encounter', 'The encounter billed.'),
    f('patientId', { id: 'patient' }, 'Patient', 'The patient billed for.'),
    f(
      'classification',
      { code: 'tripClassification' },
      'Classification',
      'What kind of trip it was.'
    ),
    f('serviceDate', 'string', 'Service Date', 'The date of service, as YYYY-MM-DD.'),
    f('level', { code: 'levelOfService' }, 'Level of Service', 'BLS, ALS1, ALS2 or SCT.'),
    f('emergency', 'boolean', 'Emergency', 'Whether the trip is billed as an emergency.'),
    f('loadedMiles', 'number', 'Loaded Miles', 'Miles with the patient on board.'),
    f('originCode', { code: 'placeCode' }, 'Origin', 'The origin letter of the modifier.'),
    f(
      'destinationCode',
      { code: 'placeCode' },
      'Destination',
      'The destination letter of the modifier.'
    ),
    f('diagnoses', { list: { code: 'icd10' } }, 'Diagnoses', 'The diagnoses, primary first.'),
    f(
      'transportReason',
      { code: 'transportReason' },
      'Transport Reason',
      'Why the patient went to this destination, A to E, for the ambulance transport information (CR1).'
    ),
    f(
      'conditionCodes',
      { list: { code: 'ambulanceCondition' } },
      'Condition Codes',
      'Up to five ambulance conditions that certify the transport (CRC).'
    ),
    f(
      'weightPounds',
      'integer',
      'Weight in Pounds',
      'The patient weight, in whole pounds, for the ambulance transport information (CR1).'
    ),
    f(
      'coverages',
      { list: modelType(COVERAGE) },
      'Coverages',
      'The payers billed, in billing order.'
    ),
    f('lines', { list: modelType(CHARGE_LINE) }, 'Charge Lines', 'The lines charged, priced.'),
    f('totalCents', 'integer', 'Total Charge', 'The total charge, in cents.'),
    f('reasons', { list: 'string' }, 'Reasons', 'Why the claim was built this way.')
  ]
);

export const CLAIM_TYPE = modelType(CLAIM);

export const billingModels: Model[] = [CLAIM, COVERAGE, CHARGE_LINE];
