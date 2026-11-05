import { type Model, type ModelField, modelType, type ValueType } from '@ugula/graph';

const CATEGORY = 'Billing';

export const X12 = 'X12 837P';

export const f = (name: string, type: ValueType, label: string): ModelField => ({
  name,
  type,
  label
});

export const model = (
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

export const ADDRESS = [
  f('addressLine', 'string', 'Street address'),
  f('city', 'string', 'City'),
  f('state', 'string', 'State'),
  f('postalCode', 'string', 'ZIP code')
];

export const BLOB = { object: { bucket: 'string', key: 'string' } } as const satisfies ValueType;

export const ADJUSTMENT_TYPE = {
  object: { group: 'string', reason: 'string', cents: 'integer' }
} as const satisfies ValueType;
