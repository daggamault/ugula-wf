import type { Json } from './types.ts';

export type JsonRecord = { [key: string]: Json };

export const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export const isTruthy = (value: unknown) =>
  value !== null && value !== false && value !== 0 && value !== '';

export const kindOf = (value: Json) =>
  value === null
    ? 'null'
    : Array.isArray(value)
      ? 'list'
      : typeof value === 'object'
        ? 'object'
        : typeof value;

export const deepEqual = (a: Json, b: Json): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i] ?? null));
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((k) => Object.hasOwn(b, k) && deepEqual(a[k] ?? null, b[k] ?? null))
    );
  }
  return false;
};

export const toText = (value: Json): string =>
  value === null
    ? ''
    : typeof value === 'string'
      ? value
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);

export const groupBy = (items: Json[], keyOf: (item: Json, index: number) => Json) => {
  const groups = new Map<string, Json[]>();
  for (const [i, item] of items.entries()) {
    const key = toText(keyOf(item, i));
    const bucket = groups.get(key);
    if (bucket) bucket.push(item);
    else groups.set(key, [item]);
  }
  return Object.fromEntries(groups);
};

export const findKey = (value: Json, key: string): Json => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findKey(item, key);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  if (Object.hasOwn(value, key)) return value[key] ?? null;
  for (const child of Object.values(value)) {
    const found = findKey(child, key);
    if (found !== null) return found;
  }
  return null;
};

export const getPath = (value: Json, path: string): Json => {
  let cur = value;
  for (const key of path.split('.').filter(Boolean)) {
    if (Array.isArray(cur) && /^\d+$/.test(key)) cur = cur[Number(key)] ?? null;
    else if (isRecord(cur) && Object.hasOwn(cur, key)) cur = cur[key] ?? null;
    else return null;
  }
  return cur;
};

export const setPath = (value: Json, path: string, next: Json): Json => {
  const [key, ...rest] = path.split('.').filter(Boolean);
  if (key === undefined) return next;
  const tail = rest.join('.');
  if (Array.isArray(value) && /^\d+$/.test(key)) {
    const copy = [...value];
    copy[Number(key)] = setPath(value[Number(key)] ?? null, tail, next);
    return Array.from(copy, (x) => x ?? null);
  }
  const base = isRecord(value) ? value : {};
  return {
    ...base,
    [key]: setPath(Object.hasOwn(base, key) ? (base[key] ?? null) : null, tail, next)
  };
};
