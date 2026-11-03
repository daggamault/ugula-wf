import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { createEvaluator, parseExpr } from '../expr.ts';
import { MAX_RANGE, sortKey } from '../expr-functions.ts';
import { deepEqual, getPath, groupBy, isTruthy } from '../json.ts';
import { jsonSchema, valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef, PinSpec, Values, ValueType } from '../types.ts';
import { type ExpressionConfig, expressionConfig, identifierPins } from './expression.ts';
import { CONDITION_OPS, holds } from './tables.ts';

const CATEGORY = 'Lists';
const ANY_LIST: ValueType = { list: 'any' };
const RESERVED = ['item', 'index', 'list'];

const listNode = (
  key: string,
  title: string,
  description: string,
  inputs: PinSpec[],
  outputs: PinSpec[],
  compute: (inputs: Values) => Values
) =>
  pureNode({
    type: `std.list.${key}`,
    title,
    category: CATEGORY,
    description,
    inputs: [pin('list', ANY_LIST), ...inputs],
    outputs,
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
    config: expressionConfig,
    inputs: ({ expression }) => [pin('list', ANY_LIST), ...identifierPins([expression], RESERVED)],
    outputs,
    compute: (inputs, { expression }, ctx) => {
      const ast = parseExpr(expression);
      const run = createEvaluator({ now: ctx.now });
      return fn(inputs.list as Json[], (item, index) => run(ast, { ...inputs, item, index }));
    }
  });

const items = (x: Values) => x.list as Json[];

const fieldOf = (item: Json, field: Json) =>
  typeof field === 'string' && field ? getPath(item, field) : item;

const whereConfig = v.object({
  field: v.optional(v.string(), ''),
  op: v.optional(v.picklist(CONDITION_OPS), 'is'),
  value: v.optional(jsonSchema)
});

const makeConfig = v.object({
  count: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1), v.maxValue(32)), 2)
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
    'Outputs how many items a list has.',
    [],
    [pin('length', 'integer')],
    (x) => ({
      length: items(x).length
    })
  ),
  listNode(
    'get',
    'Get Item',
    'Item at an index; negative counts from the end.',
    [pin('index', 'integer')],
    [pin('item', 'any')],
    (x) => ({ item: items(x).at(x.index as number) ?? null })
  ),
  listNode(
    'first',
    'First',
    'Outputs the first item of a list, or nothing when the list is empty.',
    [],
    [pin('item', 'any')],
    (x) => ({
      item: items(x)[0] ?? null
    })
  ),
  listNode(
    'last',
    'Last',
    'Outputs the last item of a list, or nothing when the list is empty.',
    [],
    [pin('item', 'any')],
    (x) => ({
      item: items(x).at(-1) ?? null
    })
  ),
  listNode(
    'append',
    'Append',
    'A new list with the item added at the end.',
    [pin('item', 'any', { optional: true })],
    [pin('list', ANY_LIST)],
    (x) => ({ list: [...items(x), x.item ?? null] })
  ),
  listNode(
    'concat',
    'Concat',
    "Joins two lists into one, with the first list's items first.",
    [pin('other', ANY_LIST)],
    [pin('list', ANY_LIST)],
    (x) => ({ list: [...items(x), ...(x.other as Json[])] })
  ),
  listNode(
    'slice',
    'Slice',
    'Items from start up to (not including) end.',
    [pin('start', 'integer', { default: 0 }), pin('end', 'integer', { optional: true })],
    [pin('list', ANY_LIST)],
    (x) => ({
      list: items(x).slice(x.start as number, x.end === null ? undefined : (x.end as number))
    })
  ),
  listNode(
    'contains',
    'Contains',
    'Outputs true when the list holds an item equal to the one given.',
    [pin('item', 'any', { optional: true })],
    [pin('result', 'boolean')],
    (x) => ({ result: items(x).some((y) => deepEqual(y, x.item ?? null)) })
  ),
  listNode(
    'index-of',
    'Index Of',
    'Outputs the position of the first equal item, counting from 0, or -1 when there is none.',
    [pin('item', 'any', { optional: true })],
    [pin('index', 'integer')],
    (x) => ({ index: items(x).findIndex((y) => deepEqual(y, x.item ?? null)) })
  ),
  listNode(
    'reverse',
    'Reverse',
    'Outputs the list in reverse order.',
    [],
    [pin('list', ANY_LIST)],
    (x) => ({
      list: [...items(x)].reverse()
    })
  ),
  listNode(
    'unique',
    'Unique',
    'Outputs the list with duplicate items removed, keeping the first of each.',
    [],
    [pin('list', ANY_LIST)],
    (x) => ({
      list: items(x).filter((x, i, all) => all.findIndex((y) => deepEqual(x, y)) === i)
    })
  ),
  listNode(
    'flatten',
    'Flatten',
    'Turns a list of lists into a single list.',
    [],
    [pin('list', ANY_LIST)],
    (x) => ({
      list: items(x).flatMap((x) => (Array.isArray(x) ? x : [x]))
    })
  ),
  listNode(
    'pluck',
    'Pluck Field',
    'Outputs the value at a field path, such as `code` or `payer.name`, from every item.',
    [pin('field', 'string')],
    [pin('list', ANY_LIST)],
    (x) => ({ list: items(x).map((item) => fieldOf(item, x.field ?? null)) })
  ),
  listNode(
    'compact',
    'Drop Empty',
    'Outputs the list without empty items.',
    [],
    [pin('list', ANY_LIST)],
    (x) => ({ list: items(x).filter((item) => !isBlank(item)) })
  ),
  listNode(
    'sort-by-field',
    'Sort By Field',
    'Sorts items by the value at a field path, smallest first unless descending. Empty values sort last.',
    [pin('field', 'string', { optional: true }), pin('descending', 'boolean', { default: false })],
    [pin('list', ANY_LIST)],
    (x) => {
      const dir = x.descending === true ? -1 : 1;
      const keyed = items(x).map((item) => ({ item, k: fieldOf(item, x.field ?? null) }));
      const blank = keyed.filter((e) => isBlank(e.k));
      return {
        list: [
          ...keyed
            .filter((e) => !isBlank(e.k))
            .map((e) => ({ item: e.item, k: sortKey('Sort By Field', e.k) }))
            .sort((a, b) => (a.k < b.k ? -dir : a.k > b.k ? dir : 0)),
          ...blank
        ].map((e) => e.item)
      };
    }
  ),
  pureNode<v.InferOutput<typeof whereConfig>>({
    type: 'std.list.where',
    title: 'Where',
    category: CATEGORY,
    description:
      'Keeps the items whose field passes a condition, such as route is one of a list of codes, and counts them.',
    config: whereConfig,
    inputs: [pin('list', ANY_LIST)],
    outputs: [pin('list', ANY_LIST), pin('count', 'integer')],
    compute: ({ list }, { field, op, value }) => {
      const kept = ((list ?? []) as Json[]).filter((item) =>
        holds({ op, value: value ?? null }, fieldOf(item, field))
      );
      return { list: kept, count: kept.length };
    }
  }),
  pureNode<v.InferOutput<typeof reshapeConfig>>({
    type: 'std.list.reshape',
    title: 'Reshape Items',
    category: CATEGORY,
    description:
      'Turns each item into a new object: each field you list is copied from a path in the item (an empty path copies the whole item), or, without a path, taken from the shared object, such as a date every line needs.',
    config: reshapeConfig,
    inputs: [pin('list', ANY_LIST), pin('shared', { object: {} }, { optional: true })],
    outputs: ({ fields }) => [
      pin('list', { list: { object: Object.fromEntries(fields.map((f) => [f.name, f.type])) } })
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
    description: 'Builds a list from its item inputs, leaving out the ones that are empty.',
    config: makeConfig,
    inputs: ({ count }) =>
      Array.from({ length: count }, (_, i) => pin(`item${i + 1}`, 'any', { optional: true })),
    outputs: [pin('list', ANY_LIST)],
    compute: (inputs, { count }) => ({
      list: Array.from({ length: count }, (_, i) => inputs[`item${i + 1}`] ?? null).filter(
        (x) => !isBlank(x)
      )
    })
  }),
  pureNode({
    type: 'std.list.range',
    title: 'Range',
    category: CATEGORY,
    description: 'Integers from start up to (not including) end.',
    inputs: [pin('start', 'integer', { default: 0 }), pin('end', 'integer')],
    outputs: [pin('list', { list: 'integer' })],
    compute: ({ start, end }) => {
      const [lo, hi] = [start as number, end as number];
      if (hi - lo > MAX_RANGE) fail(`Range: at most ${MAX_RANGE} items`);
      return { list: Array.from({ length: Math.max(0, hi - lo) }, (_, i) => lo + i) };
    }
  }),
  lambdaNode(
    'map',
    'Map',
    'Transforms each `item` with an expression, e.g. `item.amount * 2`.',
    [pin('list', ANY_LIST)],
    (xs, each) => ({
      list: xs.map(each)
    })
  ),
  lambdaNode(
    'filter',
    'Filter',
    'Keeps items where the expression holds, e.g. `item.paid == false`.',
    [pin('list', ANY_LIST)],
    (xs, each) => ({
      list: xs.filter((x, i) => isTruthy(each(x, i)))
    })
  ),
  lambdaNode(
    'find',
    'Find',
    'Outputs the first item for which the expression is true, or nothing when none is.',
    [pin('item', 'any'), pin('found', 'boolean')],
    (xs, each) => {
      const i = xs.findIndex((x, j) => isTruthy(each(x, j)));
      return { item: xs[i] ?? null, found: i >= 0 };
    }
  ),
  lambdaNode(
    'every',
    'Every',
    'True when the expression holds for all items.',
    [pin('result', 'boolean')],
    (xs, each) => ({
      result: xs.every((x, i) => isTruthy(each(x, i)))
    })
  ),
  lambdaNode(
    'some',
    'Some',
    'True when the expression holds for any item.',
    [pin('result', 'boolean')],
    (xs, each) => ({
      result: xs.some((x, i) => isTruthy(each(x, i)))
    })
  ),
  lambdaNode(
    'sort-by',
    'Sort By',
    'Sorts ascending by a key expression, e.g. `item.date`.',
    [pin('list', ANY_LIST)],
    (xs, each) => ({
      list: xs
        .map((x, i) => ({ x, k: sortKey('Sort By', each(x, i)) }))
        .sort((a, b) => (a.k < b.k ? -1 : a.k > b.k ? 1 : 0))
        .map((e) => e.x)
    })
  ),
  lambdaNode(
    'group-by',
    'Group By',
    'Groups items into an object keyed by an expression.',
    [pin('groups', { object: {} })],
    (xs, each) => ({ groups: groupBy(xs, each) })
  )
];
