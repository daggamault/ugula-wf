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
import { checkValue } from './value-types.ts';

export type FnValue = (args: ExprValue[]) => ExprValue;

export type ExprValue = Json | FnValue;

type ExprCallContext = {
  call: (fn: ExprValue, args: ExprValue[]) => ExprValue;
  charge: (units: number) => void;
  now: Date | undefined;
};

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

export const formatMoney = (cents: number) => USD.format(Math.round(cents) / 100);

export const CHARS_PER_UNIT = 32;

type ExprFunction = (args: ExprValue[], cx: ExprCallContext) => ExprValue;

const DAY_MS = 86_400_000;
export const MAX_RANGE = 100_000;

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

const parseJsonText = (text: string): Json => {
  try {
    return JSON.parse(text) as Json;
  } catch {
    return fail('parseJson: invalid JSON');
  }
};

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
  return (Math.sign(x) * Math.round((Math.abs(x) + Number.EPSILON) * f)) / f;
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

export const sortKey = (fn: string, v: ExprValue): number | string =>
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
  money: ([cents]) => formatMoney(num('money', cents ?? null)),
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
    const value = parseJsonText(str('parseJson', s ?? null));
    const err = checkValue('any', value);
    return err ? fail(`parseJson: ${err}`) : value;
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

export const EXPR_CATEGORIES = ['Math', 'Text', 'Lists', 'Records', 'Values', 'Dates'] as const;

type ExprFunctionDoc = {
  category: (typeof EXPR_CATEGORIES)[number];
  usage: string;
  description: string;
};

const doc = (
  category: ExprFunctionDoc['category'],
  usage: string,
  description: string
): ExprFunctionDoc => ({ category, usage, description });

export const exprFunctionDocs: Record<string, ExprFunctionDoc> = {
  abs: doc('Math', 'abs(x)', 'The number without its sign.'),
  ceil: doc('Math', 'ceil(x)', 'Rounds up to a whole number.'),
  floor: doc('Math', 'floor(x)', 'Rounds down to a whole number.'),
  trunc: doc('Math', 'trunc(x)', 'Drops the decimals.'),
  round: doc(
    'Math',
    'round(x, digits)',
    'Rounds half away from zero, to whole numbers unless digits are given.'
  ),
  sqrt: doc('Math', 'sqrt(x)', 'The square root.'),
  pow: doc('Math', 'pow(x, y)', 'x to the power of y.'),
  min: doc('Math', 'min(a, b, …)', 'The smallest number, of the values or a list.'),
  max: doc('Math', 'max(a, b, …)', 'The largest number, of the values or a list.'),
  sum: doc('Math', 'sum(list)', 'The numbers added up.'),
  avg: doc('Math', 'avg(list)', 'The average, or nothing when there are none.'),
  clamp: doc('Math', 'clamp(x, low, high)', 'Keeps x between low and high.'),
  upper: doc('Text', 'upper(text)', 'The text in capitals.'),
  lower: doc('Text', 'lower(text)', 'The text in small letters.'),
  trim: doc('Text', 'trim(text)', 'Drops the spaces at both ends.'),
  len: doc('Text', 'len(x)', 'How many characters, items or fields x has.'),
  contains: doc(
    'Text',
    'contains(x, part)',
    'Whether text holds the part, or a list holds the item.'
  ),
  startsWith: doc('Text', 'startsWith(text, start)', 'Whether the text begins with start.'),
  endsWith: doc('Text', 'endsWith(text, end)', 'Whether the text ends with end.'),
  replace: doc('Text', 'replace(text, find, with)', 'Replaces every find in the text.'),
  split: doc('Text', 'split(text, separator)', 'Cuts the text into a list.'),
  join: doc('Text', 'join(list, separator)', 'Joins a list into one text.'),
  substr: doc('Text', 'substr(text, start, end)', 'The part of the text from start up to end.'),
  padStart: doc(
    'Text',
    'padStart(x, width, fill)',
    'Fills on the left up to width, with spaces unless fill is given.'
  ),
  padEnd: doc(
    'Text',
    'padEnd(x, width, fill)',
    'Fills on the right up to width, with spaces unless fill is given.'
  ),
  text: doc('Text', 'text(x)', 'Any value as readable text.'),
  money: doc('Text', 'money(cents)', 'Cents as dollars, such as $12.50.'),
  number: doc('Values', 'number(x)', 'Reads text such as "12.50" as a number.'),
  map: doc('Lists', 'map(list, x => …)', 'Turns each item into a new value.'),
  filter: doc('Lists', 'filter(list, x => …)', 'Keeps the items for which the formula is true.'),
  find: doc('Lists', 'find(list, x => …)', 'The first item for which the formula is true.'),
  some: doc('Lists', 'some(list, x => …)', 'Whether the formula is true for any item.'),
  every: doc('Lists', 'every(list, x => …)', 'Whether the formula is true for every item.'),
  count: doc(
    'Lists',
    'count(list, x => …)',
    'How many items there are, or how many match the formula.'
  ),
  reduce: doc(
    'Lists',
    'reduce(list, (total, x) => …, start)',
    'Builds one value from all the items.'
  ),
  sort: doc(
    'Lists',
    'sort(list, x => …)',
    'Sorts smallest first, by the item or what the formula gives.'
  ),
  groupBy: doc(
    'Lists',
    'groupBy(list, x => …)',
    'Groups the items into a record by what the formula gives.'
  ),
  unique: doc('Lists', 'unique(list)', 'Drops repeated items.'),
  flatten: doc('Lists', 'flatten(list)', 'Turns a list of lists into one list.'),
  first: doc('Lists', 'first(list)', 'The first item.'),
  last: doc('Lists', 'last(list)', 'The last item.'),
  at: doc(
    'Lists',
    'at(list, i)',
    'The item at position i, counting from 0; negative counts from the end.'
  ),
  slice: doc('Lists', 'slice(list, start, end)', 'The items from start up to end.'),
  reverse: doc('Lists', 'reverse(list)', 'The items in reverse order.'),
  concat: doc('Lists', 'concat(a, b, …)', 'Joins lists into one.'),
  indexOf: doc(
    'Lists',
    'indexOf(x, item)',
    'Where the item first appears in a list or text, or -1.'
  ),
  range: doc('Lists', 'range(start, end)', 'The whole numbers from start up to end.'),
  keys: doc('Records', 'keys(record)', 'The names of the fields.'),
  values: doc('Records', 'values(record)', 'The values of the fields.'),
  entries: doc('Records', 'entries(record)', 'The fields as a list of { key, value }.'),
  fromEntries: doc(
    'Records',
    'fromEntries(list)',
    'Builds a record from a list of { key, value }.'
  ),
  findKey: doc('Records', 'findKey(record, name)', 'The field name that matches, ignoring case.'),
  get: doc('Records', 'get(record, "a.b")', 'The value at a dotted path, or nothing.'),
  has: doc('Records', 'has(record, name)', 'Whether the record has the field.'),
  merge: doc('Records', 'merge(a, b, …)', 'Combines records; later fields win.'),
  pick: doc('Records', 'pick(record, names)', 'Keeps only the named fields.'),
  omit: doc('Records', 'omit(record, names)', 'Drops the named fields.'),
  coalesce: doc('Values', 'coalesce(a, b, …)', 'The first value that is not empty.'),
  isNull: doc('Values', 'isNull(x)', 'Whether x is empty.'),
  type: doc('Values', 'type(x)', 'What kind of value x is, such as number or list.'),
  parseJson: doc('Values', 'parseJson(text)', 'Reads JSON text as a value.'),
  toJson: doc('Values', 'toJson(x)', 'Writes a value as JSON text.'),
  now: doc('Dates', 'now()', 'The current date and time.'),
  date: doc('Dates', 'date(x)', 'The calendar day, such as 2026-03-01.'),
  datetime: doc('Dates', 'datetime(x)', 'A full date and time in UTC.'),
  addDays: doc('Dates', 'addDays(date, days)', 'The date that many days later.'),
  daysBetween: doc('Dates', 'daysBetween(from, to)', 'Whole days from one date to another.'),
  year: doc('Dates', 'year(date)', 'The year.'),
  month: doc('Dates', 'month(date)', 'The month, 1 to 12.'),
  day: doc('Dates', 'day(date)', 'The day of the month.'),
  age: doc('Dates', 'age(birthDate, at)', 'Age in whole years, today unless at is given.')
};
