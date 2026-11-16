import { isRecord, kindOf } from './json.ts';
import { type Json, SCALAR_TYPES, type ValueKinds, type ValueType } from './types.ts';

export const KIND_NAME = /^[a-z][a-zA-Z0-9]*$/;

export const STD_KINDS: ValueKinds = { id: { run: 'Run ID' }, code: {} };

export const mergeKinds = (...all: ValueKinds[]): ValueKinds => ({
  id: Object.assign({}, ...all.map((k) => k.id)),
  code: Object.assign({}, ...all.map((k) => k.code))
});

const scalarCompat: Record<string, readonly string[]> = {
  number: ['integer'],
  integer: ['number'],
  string: ['datetime'],
  datetime: ['string']
};

export const formatType = (type: ValueType): string => {
  if (typeof type === 'string') return type;
  if ('id' in type) return `id<${type.id}>`;
  if ('code' in type) return `code<${type.code}>`;
  if ('list' in type) return `list<${formatType(type.list)}>`;
  return `object{${Object.entries(type.object)
    .map(([k, t]) => `${k}: ${formatType(t)}`)
    .join(', ')}}`;
};

const kindKey = (type: ValueType) =>
  typeof type === 'object' && ('id' in type || 'code' in type) ? formatType(type) : null;

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
  const kind = () => {
    expect('<');
    const word = name();
    if (!KIND_NAME.test(word)) throw new Error(`Invalid kind "${word}" in "${src}"`);
    expect('>');
    return word;
  };
  const type = (): ValueType => {
    const word = name();
    if (word === 'id') return { id: kind() };
    if (word === 'code') return { code: kind() };
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
    const scalar = SCALAR_TYPES.find((s) => s === word);
    if (!scalar) throw new Error(`Unknown type "${word}"`);
    return scalar;
  };
  const parsed = type();
  if (i !== text.length) throw new Error(`Unexpected "${text.slice(i)}" in "${src}"`);
  return parsed;
};

export const isAssignable = (from: ValueType, to: ValueType): boolean => {
  if (from === 'any' || to === 'any') return true;
  const fromKind = kindKey(from);
  const toKind = kindKey(to);
  if (fromKind || toKind) return fromKind === toKind || (fromKind !== null && to === 'string');
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
      const f = Object.hasOwn(from.object, k) ? from.object[k] : undefined;
      return f !== undefined && isAssignable(f, t);
    });
  }
  return false;
};

const finiteProblem = (value: Json): string | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? null : 'not a finite number';
  if (Array.isArray(value)) {
    for (const [i, x] of value.entries()) {
      const err = finiteProblem(x);
      if (err) return `[${i}]: ${err}`;
    }
  } else if (isRecord(value)) {
    for (const k in value) {
      const err = finiteProblem(value[k] ?? null);
      if (err) return `${k}: ${err}`;
    }
  }
  return null;
};

export const checkValue = (type: ValueType, value: Json): string | null =>
  finiteProblem(value) ?? checkShape(type, value);

const mismatchOf = (type: ValueType, value: Json) =>
  `expected ${formatType(type)}, got ${kindOf(value)}`;

const checkShape = (type: ValueType, value: Json): string | null => {
  if (value === null || type === 'any') return null;
  switch (type) {
    case 'string':
      return typeof value === 'string' ? null : mismatchOf(type, value);
    case 'number':
      return typeof value === 'number' && Number.isFinite(value) ? null : mismatchOf(type, value);
    case 'integer':
      return Number.isInteger(value) ? null : mismatchOf(type, value);
    case 'boolean':
      return typeof value === 'boolean' ? null : mismatchOf(type, value);
    case 'datetime':
      return typeof value === 'string' && !Number.isNaN(Date.parse(value))
        ? null
        : mismatchOf(type, value);
  }
  if ('id' in type || 'code' in type) {
    return typeof value === 'string' ? null : mismatchOf(type, value);
  }
  if ('list' in type) {
    if (!Array.isArray(value)) return mismatchOf(type, value);
    for (const [i, item] of value.entries()) {
      const err = checkShape(type.list, item);
      if (err) return `[${i}]: ${err}`;
    }
    return null;
  }
  if (!isRecord(value)) return mismatchOf(type, value);
  for (const k in type.object) {
    const t = type.object[k] ?? 'any';
    const err = checkShape(t, Object.hasOwn(value, k) ? (value[k] ?? null) : null);
    if (err) return `${k}: ${err}`;
  }
  return null;
};

export const isFileType = (type: ValueType) =>
  typeof type === 'object' &&
  'object' in type &&
  Object.keys(type.object).sort().join(',') === 'bucket,key';

export const isTextType = (type: ValueType) => type === 'string' || kindKey(type) !== null;

export const unknownKinds = (type: ValueType, kinds: ValueKinds): string[] => {
  if (typeof type === 'string') return [];
  if ('id' in type) return Object.hasOwn(kinds.id, type.id) ? [] : [formatType(type)];
  if ('code' in type) return Object.hasOwn(kinds.code, type.code) ? [] : [formatType(type)];
  if ('list' in type) return unknownKinds(type.list, kinds);
  return Object.values(type.object).flatMap((t) => unknownKinds(t, kinds));
};
