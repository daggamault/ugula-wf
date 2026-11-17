import { type Model, type ModelField, modelType, type ValueType } from '@ugula/graph';

const CATEGORY = 'Claim';

const f = (name: string, type: ValueType, label: string): ModelField => ({ name, type, label });

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
    f('code', { code: 'hcpcs' }, 'HCPCS code'),
    f('modifiers', { list: { code: 'modifier' } }, 'Modifiers, up to four'),
    f('units', 'number', 'Units (miles for mileage, 1 otherwise)'),
    f('unitCents', 'integer', 'Price of one unit, in cents'),
    f('totalCents', 'integer', 'Price of the line, in cents')
  ]
);

export const COVERAGE = model(
  'coverage',
  'coverage',
  'Coverage',
  'one payer billed for a claim, and who holds the policy',
  [
    f('payerId', { id: 'payer' }, 'Payer from the directory'),
    f('payerName', 'string', 'Payer name, as reported when no directory payer matched'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID'),
    f('relationship', 'string', 'Patient relationship to the insured (X12 code, 18 for self)'),
    f('insuredFirstName', 'string', 'Insured first name'),
    f('insuredLastName', 'string', 'Insured last name')
  ]
);

export const CLAIM = model(
  'claim',
  'claim',
  'Claim',
  'a claim for one encounter: what was done, who pays and what it costs',
  [
    f('encounterId', { id: 'encounter' }, 'Encounter billed'),
    f('patientId', { id: 'patient' }, 'Patient'),
    f('classification', 'string', 'Classification'),
    f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)'),
    f('level', 'string', 'Level of service (BLS, ALS1, ALS2 or SCT)'),
    f('emergency', 'boolean', 'Emergency'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('originCode', 'string', 'Origin modifier letter'),
    f('destinationCode', 'string', 'Destination modifier letter'),
    f('diagnoses', { list: { code: 'icd10' } }, 'Diagnoses, primary first'),
    f('coverages', { list: modelType(COVERAGE) }, 'Payers, in billing order'),
    f('lines', { list: modelType(CHARGE_LINE) }, 'Charge lines'),
    f('totalCents', 'integer', 'Total charge, in cents'),
    f('reasons', { list: 'string' }, 'Why the claim was built this way')
  ]
);

export const CLAIM_TYPE = modelType(CLAIM);

export const billingModels: Model[] = [CLAIM, COVERAGE, CHARGE_LINE];
