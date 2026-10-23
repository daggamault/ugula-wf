import { pin, pureNode } from '../define.ts';
import { fail } from '../errors.ts';
import { evaluateExpr, parseExpr } from '../expr.ts';
import { deepEqual, groupBy, isTruthy } from '../json.ts';
import type { Json, NodeDef, PinSpec, Values, ValueType } from '../types.ts';
import { type ExpressionConfig, expressionConfig, identifierPins } from './expression.ts';

const CATEGORY = 'Lists';
const MAX_RANGE = 100_000;
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
      const items = inputs.list as Json[];
      return fn(items, (item, index) =>
        evaluateExpr(ast, { ...inputs, item, index }, { now: ctx.now })
      );
    }
  });

const sortKey = (v: Json) =>
  typeof v === 'number' || typeof v === 'string'
    ? v
    : fail('Sort By: keys must be numbers or strings');

const items = (v: Values) => v.list as Json[];

export const listNodes: NodeDef[] = [
  listNode('length', 'Length', 'Number of items.', [], [pin('length', 'integer')], (v) => ({
    length: items(v).length
  })),
  listNode(
    'get',
    'Get Item',
    'Item at an index; negative counts from the end.',
    [pin('index', 'integer')],
    [pin('item', 'any')],
    (v) => ({ item: items(v).at(v.index as number) ?? null })
  ),
  listNode('first', 'First', 'The first item.', [], [pin('item', 'any')], (v) => ({
    item: items(v)[0] ?? null
  })),
  listNode('last', 'Last', 'The last item.', [], [pin('item', 'any')], (v) => ({
    item: items(v).at(-1) ?? null
  })),
  listNode(
    'append',
    'Append',
    'A new list with the item added at the end.',
    [pin('item', 'any', { optional: true })],
    [pin('list', ANY_LIST)],
    (v) => ({ list: [...items(v), v.item ?? null] })
  ),
  listNode(
    'concat',
    'Concat',
    'Joins two lists.',
    [pin('other', ANY_LIST)],
    [pin('list', ANY_LIST)],
    (v) => ({ list: [...items(v), ...(v.other as Json[])] })
  ),
  listNode(
    'slice',
    'Slice',
    'Items from start up to (not including) end.',
    [pin('start', 'integer', { default: 0 }), pin('end', 'integer', { optional: true })],
    [pin('list', ANY_LIST)],
    (v) => ({
      list: items(v).slice(v.start as number, v.end === null ? undefined : (v.end as number))
    })
  ),
  listNode(
    'contains',
    'Contains',
    'True when the list holds an equal item.',
    [pin('item', 'any', { optional: true })],
    [pin('result', 'boolean')],
    (v) => ({ result: items(v).some((x) => deepEqual(x, v.item ?? null)) })
  ),
  listNode(
    'index-of',
    'Index Of',
    'Index of the first equal item, or -1.',
    [pin('item', 'any', { optional: true })],
    [pin('index', 'integer')],
    (v) => ({ index: items(v).findIndex((x) => deepEqual(x, v.item ?? null)) })
  ),
  listNode('reverse', 'Reverse', 'Items in reverse order.', [], [pin('list', ANY_LIST)], (v) => ({
    list: [...items(v)].reverse()
  })),
  listNode('unique', 'Unique', 'Removes duplicate items.', [], [pin('list', ANY_LIST)], (v) => ({
    list: items(v).filter((x, i, all) => all.findIndex((y) => deepEqual(x, y)) === i)
  })),
  listNode(
    'flatten',
    'Flatten',
    'Flattens nested lists one level.',
    [],
    [pin('list', ANY_LIST)],
    (v) => ({
      list: items(v).flatMap((x) => (Array.isArray(x) ? x : [x]))
    })
  ),
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
    'First item where the expression holds.',
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
        .map((x, i) => ({ x, k: sortKey(each(x, i)) }))
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
