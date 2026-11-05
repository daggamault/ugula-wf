import { isRecord, kindOf } from './json.ts';
import type { Json, ValueType } from './types.ts';

const scalarCompat: Record<string, readonly string[]> = {
  number: ['integer'],
  integer: ['number'],
  string: ['datetime'],
  datetime: ['string']
};

export const formatType = (type: ValueType): string =>
  typeof type === 'string'
    ? type
    : 'list' in type
      ? `list<${formatType(type.list)}>`
      : `object{${Object.entries(type.object)
          .map(([k, t]) => `${k}: ${formatType(t)}`)
          .join(', ')}}`;

const SCALARS = ['any', 'string', 'number', 'integer', 'boolean', 'datetime'] as const;

export const parseType = (src: string): ValueType => {
  let i = 0;
  const text = src.replace(/\s+/g, '');
  const expect = (token: string) => {
    if (!text.startsWith(token, i)) throw new Error(`Expected "${token}" at ${i} in "${src}"`);
    i += token.length;
  };
  const name = () => {
    const m = /^[A-Za-z_$][\w$]*/.exec(text.slice(i));
    if (!m) throw new Error(`Expected a name at ${i} in "${src}"`);
    i += m[0].length;
    return m[0];
  };
  const type = (): ValueType => {
    const word = name();
    if (word === 'list') {
      expect('<');
      const item = type();
      expect('>');
      return { list: item };
    }
    if (word === 'object') {
      const fields: Record<string, ValueType> = {};
      if (!text.startsWith('{', i)) return { object: fields };
      expect('{');
      while (!text.startsWith('}', i)) {
        const field = name();
        expect(':');
        fields[field] = type();
        if (!text.startsWith('}', i)) expect(',');
      }
      expect('}');
      return { object: fields };
    }
    const scalar = SCALARS.find((s) => s === word);
    if (!scalar) throw new Error(`Unknown type "${word}"`);
    return scalar;
  };
  const parsed = type();
  if (i !== text.length) throw new Error(`Unexpected "${text.slice(i)}" in "${src}"`);
  return parsed;
};

export const isAssignable = (from: ValueType, to: ValueType): boolean => {
  if (from === 'any' || to === 'any') return true;
  if (typeof from === 'string' || typeof to === 'string') {
    return (
      from === to ||
      (typeof from === 'string' &&
        typeof to === 'string' &&
        (scalarCompat[from]?.includes(to) ?? false))
    );
  }
  if ('list' in from && 'list' in to) return isAssignable(from.list, to.list);
  if ('object' in from && 'object' in to) {
    return Object.entries(to.object).every(([k, t]) => {
      const f = from.object[k];
      return f === undefined || isAssignable(f, t);
    });
  }
  return false;
};

const finiteProblem = (value: Json): string | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'not a finite number';
  const entries = Array.isArray(value)
    ? value.map((x, i) => [`[${i}]`, x] as const)
    : isRecord(value)
      ? Object.entries(value)
      : [];
  for (const [at, x] of entries) {
    const err = finiteProblem(x);
    if (err) return `${at}: ${err}`;
  }
  return null;
};

export const checkValue = (type: ValueType, value: Json): string | null =>
  finiteProblem(value) ?? checkShape(type, value);

const checkShape = (type: ValueType, value: Json): string | null => {
  if (value === null || type === 'any') return null;
  const mismatch = `expected ${formatType(type)}, got ${kindOf(value)}`;
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : mismatch;
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : mismatch;
    case 'integer':
      return Number.isInteger(value) ? null : mismatch;
    case 'boolean':
      return typeof value === 'boolean' ? null : mismatch;
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? null : mismatch;
  }
  if ('list' in type) {
    if (!Array.isArray(value)) return mismatch;
    for (const [i, item] of value.entries()) {
      const err = checkShape(type.list, item);
      if (err) return `[${i}]: ${err}`;
    }
    return null;
  }
  if (!isRecord(value)) return mismatch;
  for (const [k, t] of Object.entries(type.object)) {
    const err = checkShape(t, Object.hasOwn(value, k) ? (value[k] ?? null) : null);
    if (err) return `${k}: ${err}`;
  }
  return null;
};

export const isFileType = (type: ValueType) =>
  typeof type === 'object' &&
  'object' in type &&
  Object.keys(type.object).sort().join(',') === 'bucket,key';
