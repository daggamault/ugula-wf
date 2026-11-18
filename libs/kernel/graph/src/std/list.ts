import * as v from 'valibot';
import { adoptsItemType, adoptsType, pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { createEvaluator, parseExpr } from '../expr.ts';
import { MAX_RANGE, sortKey } from '../expr-functions.ts';
import { deepEqual, getPath, groupBy, isTruthy } from '../json.ts';
import { type TypeConfig, typeConfig, valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef, PinSpec, Values, ValueType } from '../types.ts';
import { type ExpressionConfig, expressionConfig, identifierPins, oneLine } from './expression.ts';

const CATEGORY = 'Lists';
const ANY_LIST: ValueType = { list: 'any' };
export const LIST_FORMULA_NAMES = ['item', 'index', 'list'];
const LIST_IN = pin('list', ANY_LIST, {
  optional: true,
  description: 'The list to work on; an empty list when missing.'
});
const LIST_OUT = pin('list', ANY_LIST, { description: 'The resulting list.' });
const RESULT = pin('result', 'boolean', { description: 'True or false.' });

const listIn = (type: ValueType) => ({ ...LIST_IN, type: { list: type } });

const listOut = (type: ValueType) => ({ ...LIST_OUT, type: { list: type } });

const itemIn = (type: ValueType) => pin('item', type, { optional: true, description: 'The item.' });

const itemOut = (type: ValueType) => pin('item', type, { description: 'The item, or nothing.' });

const otherIn = (type: ValueType) =>
  pin('other', { list: type }, { description: 'The list to add after it.' });

type TypedPins = (type: ValueType) => PinSpec[];

const listNode = (
  key: string,
  title: string,
  description: string,
  inputs: TypedPins,
  outputs: TypedPins,
  compute: (inputs: Values) => Values
) =>
  pureNode<TypeConfig>({
    type: `std.list.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'basic',
    keywords: ['list'],
    config: typeConfig,
    adopts: [...adoptsItemType(/^(list|other)$/), ...adoptsType(/^item$/)],
    inputs: ({ type }) => [listIn(type), ...inputs(type)],
    outputs: ({ type }) => outputs(type),
    compute
  });

const lambdaNode = (
  key: string,
  title: string,
  description: string,
  outputs: PinSpec[],
  fn: (items: Json[], each: (item: Json, index: number) => Json) => Values
) =>
  pureNode<ExpressionConfig>({
    type: `std.list.${key}`,
    title,
    category: CATEGORY,
    description,
    level: 'advanced',
    keywords: ['list', 'formula'],
    summary: ({ expression }) => oneLine(expression),
    config: expressionConfig,
    inputs: ({ expression }) => [LIST_IN, ...identifierPins([expression], LIST_FORMULA_NAMES)],
    outputs,
    compute: (inputs, { expression }, ctx) => {
      const ast = parseExpr(expression);
      const run = createEvaluator({ now: ctx.now });
      return fn((inputs.list ?? []) as Json[], (item, index) =>
        run(ast, { ...inputs, item, index })
      );
    }
  });

const items = (x: Values) => (x.list ?? []) as Json[];

const fieldOf = (item: Json, field: Json) =>
  typeof field === 'string' && field ? getPath(item, field) : item;

const makeConfig = v.object({
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32)), 2),
  type: v.optional(valueTypeSchema, 'any')
});

const isBlank = (x: Json) => x === null || x === '';

const reshapeConfig = v.object({
  fields: v.pipe(
    v.array(
      v.strictObject({
        name: v.pipe(v.string(), v.regex(/^[A-Za-z_$][\w$]*$/, 'Names must be identifiers')),
        type: valueTypeSchema,
        from: v.exactOptional(v.string())
      })
    ),
    v.minLength(1),
    v.check((fs) => new Set(fs.map((f) => f.name)).size === fs.length, 'Field names must be unique')
  )
});

export const listNodes: NodeDef[] = [
  listNode(
    'length',
    'Length',
    'Counts the items of a list.',
    () => [],
    () => [pin('length', 'integer', { description: 'How many items the list has.' })],
    (x) => ({
      length: items(x).length
    })
  ),
  listNode(
    'get',
    'Get Item',
    'Gives the item at a position, counting from 0; a negative position counts from the end.',
    () => [pin('index', 'integer', { description: 'The position of the item.' })],
    (t) => [itemOut(t)],
    (x) => ({ item: items(x).at(x.index as number) ?? null })
  ),
  listNode(
    'first',
    'First',
    'Gives the first item of a list, or nothing when the list is empty.',
    () => [],
    (t) => [itemOut(t)],
    (x) => ({
      item: items(x)[0] ?? null
    })
  ),
  listNode(
    'last',
    'Last',
    'Gives the last item of a list, or nothing when the list is empty.',
    () => [],
    (t) => [itemOut(t)],
    (x) => ({
      item: items(x).at(-1) ?? null
    })
  ),
  listNode(
    'append',
    'Append',
    'Gives a copy of the list with the item added at the end.',
    (t) => [itemIn(t)],
    (t) => [listOut(t)],
    (x) => ({ list: [...items(x), x.item ?? null] })
  ),
  listNode(
    'concat',
    'Concat',
    "Joins two lists into one, with the first list's items first.",
    (t) => [otherIn(t)],
    (t) => [listOut(t)],
    (x) => ({ list: [...items(x), ...(x.other as Json[])] })
  ),
  listNode(
    'slice',
    'Slice',
    'Takes the items from the start position up to but not including the end position.',
    () => [
      pin('start', 'integer', { default: 0, description: 'Where to start, counting from 0.' }),
      pin('end', 'integer', {
        optional: true,
        description: 'Where to stop; the end of the list when empty.'
      })
    ],
    (t) => [listOut(t)],
    (x) => ({
      list: items(x).slice(x.start as number, x.end === null ? undefined : (x.end as number))
    })
  ),
  listNode(
    'contains',
    'Contains',
    'True when the list holds an item equal to the one given.',
    (t) => [itemIn(t)],
    () => [RESULT],
    (x) => ({ result: items(x).some((y) => deepEqual(y, x.item ?? null)) })
  ),
  listNode(
    'contains-any',
    'Contains Any',
    'True when the list holds any of the items looked for, such as any of a list of codes; gives the items it holds.',
    (t) => [
      pin(
        'other',
        { list: t },
        {
          optional: true,
          label: 'Items to Find',
          description: 'The items to look for; nothing is found when empty.'
        }
      )
    ],
    (t) => [
      RESULT,
      pin('matches', { list: t }, { description: 'The items looked for that the list holds.' })
    ],
    (x) => {
      const matches = ((x.other ?? []) as Json[]).filter((o) =>
        items(x).some((y) => deepEqual(y, o))
      );
      return { result: matches.length > 0, matches };
    }
  ),
  listNode(
    'index-of',
    'Index of',
    'Gives the position of the first equal item, counting from 0, or -1 when there is none.',
    (t) => [itemIn(t)],
    () => [pin('index', 'integer', { description: 'The position, or -1.' })],
    (x) => ({ index: items(x).findIndex((y) => deepEqual(y, x.item ?? null)) })
  ),
  listNode(
    'reverse',
    'Reverse',
    'Gives the list in reverse order.',
    () => [],
    (t) => [listOut(t)],
    (x) => ({
      list: [...items(x)].reverse()
    })
  ),
  listNode(
    'unique',
    'Unique',
    'Gives the list with repeated items left out, keeping the first of each.',
    () => [],
    (t) => [listOut(t)],
    (x) => ({
      list: items(x).filter((x, i, all) => all.findIndex((y) => deepEqual(x, y)) === i)
    })
  ),
  listNode(
    'flatten',
    'Flatten',
    'Turns a list of lists into a single list.',
    () => [],
    () => [LIST_OUT],
    (x) => ({
      list: items(x).flatMap((x) => (Array.isArray(x) ? x : [x]))
    })
  ),
  listNode(
    'pluck',
    'Pluck Field',
    'Gives the value at a path, such as code or payer.name, of every item.',
    () => [pin('field', 'string', { description: 'Where the value is in each item.' })],
    () => [LIST_OUT],
    (x) => ({ list: items(x).map((item) => fieldOf(item, x.field ?? null)) })
  ),
  listNode(
    'compact',
    'Drop Empty',
    'Gives the list without its empty items.',
    () => [],
    (t) => [listOut(t)],
    (x) => ({ list: items(x).filter((item) => !isBlank(item)) })
  ),
  listNode(
    'sort-by-field',
    'Sort by Field',
    'Sorts items by the value at a field path, smallest first unless descending. Empty values sort last.',
    () => [
      pin('field', 'string', {
        optional: true,
        description: 'Where the value to sort by is in each item; the item itself when empty.'
      }),
      pin('descending', 'boolean', { default: false, description: 'Largest first instead.' })
    ],
    (t) => [listOut(t)],
    (x) => {
      const dir = x.descending === true ? -1 : 1;
      const keyed = items(x).map((item) => ({ item, k: fieldOf(item, x.field ?? null) }));
      const blank = keyed.filter((e) => isBlank(e.k));
      return {
        list: [
          ...keyed
            .filter((e) => !isBlank(e.k))
            .map((e) => ({ item: e.item, k: sortKey('Sort by Field', e.k) }))
            .sort((a, b) => (a.k < b.k ? -dir : a.k > b.k ? dir : 0)),
          ...blank
        ].map((e) => e.item)
      };
    }
  ),
  pureNode<v.InferOutput<typeof reshapeConfig>>({
    type: 'std.list.reshape',
    title: 'Reshape Items',
    category: CATEGORY,
    description:
      'Turns each item into a new record: each field you list is copied from a path in the item (an empty path copies the whole item), or, without a path, taken from the shared record, such as a date every line needs.',
    level: 'advanced',
    keywords: ['list', 'map', 'transform', 'fields'],
    summary: ({ fields }) => `Fields: ${fields.map((f) => f.name).join(', ')}`,
    config: reshapeConfig,
    inputs: [
      LIST_IN,
      pin(
        'shared',
        { object: {} },
        {
          optional: true,
          description: 'Values every new item gets, by field name.'
        }
      )
    ],
    outputs: ({ fields }) => [
      pin(
        'list',
        { list: { object: Object.fromEntries(fields.map((f) => [f.name, f.type])) } },
        { description: 'The new items.' }
      )
    ],
    compute: ({ list, shared }, { fields }) => ({
      list: ((list ?? []) as Json[]).map((item) =>
        Object.fromEntries(
          fields.map((f) => [
            f.name,
            f.from === undefined ? getPath(shared ?? null, f.name) : fieldOf(item, f.from)
          ])
        )
      )
    })
  }),
  pureNode<v.InferOutput<typeof makeConfig>>({
    type: 'std.list.make',
    title: 'Make List',
    category: CATEGORY,
    description: 'Builds a list from the values connected to it, leaving out the empty ones.',
    level: 'basic',
    keywords: ['list', 'build', 'create', 'array'],
    config: makeConfig,
    adopts: adoptsType(/^item\d+$/),
    inputs: ({ count, type }) =>
      Array.from({ length: count }, (_, i) =>
        pin(`item${i + 1}`, type, { optional: true, description: 'An item of the list.' })
      ),
    outputs: ({ type }) => [pin('list', { list: type }, { description: 'The list.' })],
    compute: (inputs, { count }) => ({
      list: Array.from({ length: count }, (_, i) => inputs[`item${i + 1}`] ?? null).filter(
        (x) => !isBlank(x)
      )
    })
  }),
  pureNode<v.InferOutput<typeof makeConfig>>({
    type: 'std.list.join',
    title: 'Join Lists',
    category: CATEGORY,
    description:
      'Joins the lists connected to it into one, in order, such as the issues every check found.',
    level: 'basic',
    keywords: ['list', 'join', 'concat', 'combine', 'merge', 'append'],
    config: makeConfig,
    adopts: adoptsItemType(/^list\d+$/),
    inputs: ({ count, type }) =>
      Array.from({ length: count }, (_, i) =>
        pin(`list${i + 1}`, { list: type }, { optional: true, description: 'A list to add.' })
      ),
    outputs: ({ type }) => [pin('list', { list: type }, { description: 'Every item, in order.' })],
    compute: (inputs, { count }) => ({
      list: Array.from({ length: count }, (_, i) => inputs[`list${i + 1}`] ?? []).flatMap((x) =>
        Array.isArray(x) ? x : []
      )
    })
  }),
  pureNode({
    type: 'std.list.range',
    title: 'Range',
    category: CATEGORY,
    description: 'Lists the whole numbers from the start up to but not including the end.',
    level: 'advanced',
    keywords: ['list', 'numbers', 'sequence', 'count'],
    inputs: [
      pin('start', 'integer', { default: 0, description: 'The first number.' }),
      pin('end', 'integer', { description: 'The number to stop before.' })
    ],
    outputs: [pin('list', { list: 'integer' }, { description: 'The numbers.' })],
    compute: ({ start, end }) => {
      const [lo, hi] = [start as number, end as number];
      if (hi - lo > MAX_RANGE) fail(`Range: at most ${MAX_RANGE} items`);
      return { list: Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i) };
    }
  }),
  lambdaNode(
    'map',
    'Map',
    'Turns each item into a new value with a formula, such as item.amount * 2.',
    [LIST_OUT],
    (xs, each) => ({
      list: xs.map(each)
    })
  ),
  lambdaNode(
    'filter',
    'Filter',
    'Keeps the items for which a formula is true, such as item.paid == false.',
    [LIST_OUT],
    (xs, each) => ({
      list: xs.filter((x, i) => isTruthy(each(x, i)))
    })
  ),
  lambdaNode(
    'find',
    'Find',
    'Gives the first item for which a formula is true, or nothing when none is.',
    [
      pin('item', 'any', { description: 'The item found, or nothing.' }),
      pin('found', 'boolean', { description: 'Whether an item was found.' })
    ],
    (xs, each) => {
      const i = xs.findIndex((x, j) => isTruthy(each(x, j)));
      return { item: xs[i] ?? null, found: i >= 0 };
    }
  ),
  lambdaNode(
    'every',
    'Every',
    'True when a formula is true for every item.',
    [RESULT],
    (xs, each) => ({
      result: xs.every((x, i) => isTruthy(each(x, i)))
    })
  ),
  lambdaNode(
    'some',
    'Some',
    'True when a formula is true for at least one item.',
    [RESULT],
    (xs, each) => ({
      result: xs.some((x, i) => isTruthy(each(x, i)))
    })
  ),
  lambdaNode(
    'sort-by',
    'Sort by',
    'Sorts the items, smallest first, by what a formula such as item.date gives for each.',
    [LIST_OUT],
    (xs, each) => ({
      list: xs
        .map((x, i) => ({ x, k: sortKey('Sort by', each(x, i)) }))
        .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
        .map((e) => e.x)
    })
  ),
  lambdaNode(
    'group-by',
    'Group by',
    'Groups the items into a record by what a formula gives for each.',
    [pin('groups', { object: {} }, { description: 'The items of each group, by group.' })],
    (xs, each) => ({ groups: groupBy(xs, each) })
  )
];
