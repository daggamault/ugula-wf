import { fail } from './errors.ts';
import {
  deepEqual,
  findKey,
  getPath,
  groupBy,
  isRecord,
  isTruthy,
  type JsonRecord,
  kindOf,
  toText
} from './json.ts';
import type { Json } from './types.ts';

export type FnValue = (args: ExprValue[]) => ExprValue;

export type ExprValue = Json | FnValue;

export type ExprCallContext = {
  call: (fn: ExprValue, args: ExprValue[]) => ExprValue;
  charge: (units: number) => void;
  now: Date | undefined;
};

export const CHARS_PER_UNIT = 32;

export type ExprFunction = (args: ExprValue[], cx: ExprCallContext) => ExprValue;

const DAY_MS = 86_400_000;
const MAX_RANGE = 100_000;

const describe = (v: ExprValue) => (typeof v === 'function' ? 'function' : kindOf(v));

const json = (fn: string, v: ExprValue): Json =>
  typeof v === 'function' ? fail(`${fn}: a function cannot be used as a value`) : v;

const num = (fn: string, v: ExprValue): number =>
  typeof v === 'number' ? v : fail(`${fn}: expected number, got ${describe(v)}`);

const str = (fn: string, v: ExprValue): string =>
  typeof v === 'string' ? v : fail(`${fn}: expected string, got ${describe(v)}`);

const list = (fn: string, v: ExprValue): Json[] =>
  Array.isArray(v) ? v : fail(`${fn}: expected list, got ${describe(v)}`);

const rec = (fn: string, v: ExprValue): JsonRecord =>
  isRecord(v) ? v : fail(`${fn}: expected object, got ${describe(v)}`);

const date = (fn: string, v: ExprValue): Date => {
  const d = new Date(str(fn, v));
  return Number.isNaN(d.getTime()) ? fail(`${fn}: invalid date "${String(v)}"`) : d;
};

const isDateOnly = (v: ExprValue) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

const finite = (fn: string, n: number) =>
  Number.isFinite(n) ? n : fail(`${fn}: result is not a finite number`);

const nums = (fn: string, args: ExprValue[]) =>
  (args.length === 1 && Array.isArray(args[0]) ? args[0] : args).map((x) => num(fn, x));

export const parseNumber = (v: Json): number => {
  if (typeof v === 'number') return v;
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : fail(`Cannot convert "${toText(v)}" to a number`);
};

export const ageAt = (born: Date, ref: Date) => {
  const years = ref.getUTCFullYear() - born.getUTCFullYear();
  const beforeBirthday =
    ref.getUTCMonth() < born.getUTCMonth() ||
    (ref.getUTCMonth() === born.getUTCMonth() && ref.getUTCDate() < born.getUTCDate());
  return beforeBirthday ? years - 1 : years;
};

export const roundTo = (x: number, digits: number) => {
  const f = 10 ** digits;
  return Math.round((x + Math.sign(x) * Number.EPSILON) * f) / f;
};

const keyOf = (x: Json): string =>
  Array.isArray(x)
    ? `[${x.map(keyOf).join(',')}]`
    : isRecord(x)
      ? `{${Object.keys(x)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${keyOf(x[k] ?? null)}`)
          .join(',')}}`
      : JSON.stringify(x);

const padTo = (fn: string, n: ExprValue, cx: ExprCallContext) => {
  const width = num(fn, n);
  cx.charge(Math.max(0, width) / CHARS_PER_UNIT);
  return width;
};

const sortKey = (fn: string, v: ExprValue): number | string =>
  typeof v === 'number' || typeof v === 'string'
    ? v
    : fail(`${fn}: can only sort by numbers or strings`);

const mapper =
  (fn: string, cx: ExprCallContext, f: ExprValue) =>
  (x: Json, i: number): Json =>
    json(fn, cx.call(f, [x, i]));

export const exprFunctions: Record<string, ExprFunction> = {
  abs: ([x]) => Math.abs(num('abs', x ?? null)),
  ceil: ([x]) => Math.ceil(num('ceil', x ?? null)),
  floor: ([x]) => Math.floor(num('floor', x ?? null)),
  trunc: ([x]) => Math.trunc(num('trunc', x ?? null)),
  round: ([x, d]) =>
    finite('round', roundTo(num('round', x ?? null), d == null ? 0 : num('round', d))),
  sqrt: ([x]) => finite('sqrt', Math.sqrt(num('sqrt', x ?? null))),
  pow: ([x, y]) => finite('pow', num('pow', x ?? null) ** num('pow', y ?? null)),
  min: (args) => {
    const xs = nums('min', args);
    return xs.length ? Math.min(...xs) : null;
  },
  max: (args) => {
    const xs = nums('max', args);
    return xs.length ? Math.max(...xs) : null;
  },
  sum: (args) =>
    finite(
      'sum',
      nums('sum', args).reduce((a, b) => a + b, 0)
    ),
  avg: (args) => {
    const xs = nums('avg', args);
    return xs.length ? finite('avg', xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  },
  clamp: ([x, lo, hi]) =>
    Math.min(Math.max(num('clamp', x ?? null), num('clamp', lo ?? null)), num('clamp', hi ?? null)),

  upper: ([s]) => str('upper', s ?? null).toUpperCase(),
  lower: ([s]) => str('lower', s ?? null).toLowerCase(),
  trim: ([s]) => str('trim', s ?? null).trim(),
  len: ([x]) => {
    const v = x ?? null;
    if (typeof v === 'string' || Array.isArray(v)) return v.length;
    return isRecord(v)
      ? Object.keys(v).length
      : fail(`len: expected string, list or object, got ${describe(v)}`);
  },
  contains: ([x, y]) => {
    const v = x ?? null;
    if (typeof v === 'string') return v.includes(str('contains', y ?? null));
    return list('contains', v).some((item) => deepEqual(item, json('contains', y ?? null)));
  },
  startsWith: ([s, p]) => str('startsWith', s ?? null).startsWith(str('startsWith', p ?? null)),
  endsWith: ([s, p]) => str('endsWith', s ?? null).endsWith(str('endsWith', p ?? null)),
  replace: ([s, a, b], cx) => {
    const [text, find, by] = [
      str('replace', s ?? null),
      str('replace', a ?? null),
      str('replace', b ?? null)
    ];
    const pieces = text.length / Math.max(1, find.length) + 1;
    cx.charge((text.length + pieces * by.length) / CHARS_PER_UNIT);
    return text.replaceAll(find, by);
  },
  split: ([s, sep]) => str('split', s ?? null).split(str('split', sep ?? null)),
  join: ([xs, sep]) =>
    list('join', xs ?? null)
      .map(toText)
      .join(sep == null ? '' : str('join', sep)),
  substr: ([s, a, b]) =>
    str('substr', s ?? null).slice(
      num('substr', a ?? null),
      b == null ? undefined : num('substr', b)
    ),
  padStart: ([s, n, ch], cx) =>
    toText(json('padStart', s ?? null)).padStart(
      padTo('padStart', n ?? null, cx),
      ch == null ? ' ' : str('padStart', ch)
    ),
  padEnd: ([s, n, ch], cx) =>
    toText(json('padEnd', s ?? null)).padEnd(
      padTo('padEnd', n ?? null, cx),
      ch == null ? ' ' : str('padEnd', ch)
    ),
  text: ([x]) => toText(json('text', x ?? null)),
  number: ([x]) => parseNumber(json('number', x ?? null)),

  map: ([xs, f], cx) => list('map', xs ?? null).map(mapper('map', cx, f ?? null)),
  filter: ([xs, f], cx) =>
    list('filter', xs ?? null).filter((x, i) => isTruthy(cx.call(f ?? null, [x, i]))),
  find: ([xs, f], cx) =>
    list('find', xs ?? null).find((x, i) => isTruthy(cx.call(f ?? null, [x, i]))) ?? null,
  some: ([xs, f], cx) =>
    list('some', xs ?? null).some((x, i) => isTruthy(cx.call(f ?? null, [x, i]))),
  every: ([xs, f], cx) =>
    list('every', xs ?? null).every((x, i) => isTruthy(cx.call(f ?? null, [x, i]))),
  count: ([xs, f], cx) => {
    const items = list('count', xs ?? null);
    return f == null ? items.length : items.filter((x, i) => isTruthy(cx.call(f, [x, i]))).length;
  },
  reduce: ([xs, f, init], cx) =>
    list('reduce', xs ?? null).reduce<Json>(
      (acc, x, i) => json('reduce', cx.call(f ?? null, [acc, x, i])),
      json('reduce', init ?? null)
    ),
  sort: ([xs, f], cx) => {
    const items = list('sort', xs ?? null);
    const keyed = items.map((x, i) => ({
      x,
      k: sortKey('sort', f == null ? x : cx.call(f, [x, i]))
    }));
    return keyed.sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0)).map((e) => e.x);
  },
  groupBy: ([xs, f], cx) =>
    groupBy(list('groupBy', xs ?? null), (x, i) => json('groupBy', cx.call(f ?? null, [x, i]))),
  unique: ([xs]) => {
    const seen = new Set<string>();
    return list('unique', xs ?? null).filter((x) => {
      const key = keyOf(x);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  },
  flatten: ([xs]) => list('flatten', xs ?? null).flatMap((x) => (Array.isArray(x) ? x : [x])),
  first: ([xs]) => list('first', xs ?? null)[0] ?? null,
  last: ([xs]) => list('last', xs ?? null).at(-1) ?? null,
  at: ([xs, i]) => list('at', xs ?? null).at(num('at', i ?? null)) ?? null,
  slice: ([xs, a, b]) =>
    list('slice', xs ?? null).slice(
      num('slice', a ?? null),
      b == null ? undefined : num('slice', b)
    ),
  reverse: ([xs]) => [...list('reverse', xs ?? null)].reverse(),
  concat: (args) => args.flatMap((x) => list('concat', x)),
  indexOf: ([xs, x]) => {
    const v = xs ?? null;
    if (typeof v === 'string') return v.indexOf(str('indexOf', x ?? null));
    return list('indexOf', v).findIndex((y) => deepEqual(y, json('indexOf', x ?? null)));
  },
  range: ([a, b], cx) => {
    const [lo, hi] =
      b == null ? [0, num('range', a ?? null)] : [num('range', a ?? null), num('range', b)];
    if (hi - lo > MAX_RANGE) fail(`range: at most ${MAX_RANGE} items`);
    cx.charge(Math.max(0, hi - lo));
    return Array.from({ length: Math.max(0, Math.ceil(hi - lo)) }, (_, i) => lo + i);
  },

  keys: ([o]) => Object.keys(rec('keys', o ?? null)),
  values: ([o]) => Object.values(rec('values', o ?? null)),
  entries: ([o]) =>
    Object.entries(rec('entries', o ?? null)).map(([key, value]) => ({ key, value })),
  fromEntries: ([xs]) =>
    Object.fromEntries(
      list('fromEntries', xs ?? null).map((e) => {
        const r = rec('fromEntries', e);
        return [toText(r.key ?? null), r.value ?? null];
      })
    ),
  findKey: ([o, key]) => findKey(json('findKey', o ?? null), str('findKey', key ?? null)),
  get: ([o, path]) => getPath(json('get', o ?? null), str('get', path ?? null)),
  has: ([o, k]) => Object.hasOwn(rec('has', o ?? null), str('has', k ?? null)),
  merge: (args) => Object.fromEntries(args.flatMap((x) => Object.entries(rec('merge', x)))),
  pick: ([o, ks]) => {
    const r = rec('pick', o ?? null);
    return Object.fromEntries(
      list('pick', ks ?? null)
        .map((k) => str('pick', k))
        .filter((k) => Object.hasOwn(r, k))
        .map((k) => [k, r[k] ?? null])
    );
  },
  omit: ([o, ks]) => {
    const drop = new Set(list('omit', ks ?? null).map((k) => str('omit', k)));
    return Object.fromEntries(Object.entries(rec('omit', o ?? null)).filter(([k]) => !drop.has(k)));
  },

  coalesce: (args) => args.find((x) => x !== null) ?? null,
  isNull: ([x]) => (x ?? null) === null,
  type: ([x]) => describe(x ?? null),
  parseJson: ([s]) => {
    try {
      return JSON.parse(str('parseJson', s ?? null)) as Json;
    } catch {
      return fail('parseJson: invalid JSON');
    }
  },
  toJson: ([x]) => JSON.stringify(json('toJson', x ?? null)),

  now: (_, cx) => (cx.now ?? fail('now: no clock available')).toISOString(),
  date: ([x]) =>
    date('date', x ?? null)
      .toISOString()
      .slice(0, 10),
  datetime: ([x]) => date('datetime', x ?? null).toISOString(),
  addDays: ([x, n]) => {
    const d = new Date(date('addDays', x ?? null).getTime() + num('addDays', n ?? null) * DAY_MS);
    return isDateOnly(x ?? null) ? d.toISOString().slice(0, 10) : d.toISOString();
  },
  daysBetween: ([a, b]) =>
    Math.round(
      (date('daysBetween', b ?? null).getTime() - date('daysBetween', a ?? null).getTime()) / DAY_MS
    ),
  year: ([x]) => date('year', x ?? null).getUTCFullYear(),
  month: ([x]) => date('month', x ?? null).getUTCMonth() + 1,
  day: ([x]) => date('day', x ?? null).getUTCDate(),
  age: ([dob, at], cx) =>
    ageAt(
      date('age', dob ?? null),
      at == null ? (cx.now ?? fail('age: no clock available')) : date('age', at)
    )
};
