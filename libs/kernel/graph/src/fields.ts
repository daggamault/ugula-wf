import type { FieldSpec } from './schemas.ts';
import type { Json } from './types.ts';
import { checkValue } from './value-types.ts';

export const checkField = (field: FieldSpec, value: Json): string | null =>
  checkValue(field.type, value) ??
  (value !== null && field.options && !field.options.some((o) => o.value === String(value))
    ? `must be one of ${field.options.map((o) => o.value).join(', ')}`
    : null);
