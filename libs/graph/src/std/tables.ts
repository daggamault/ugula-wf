import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { toText } from '../json.ts';
import { fieldsSchema, jsonSchema, valuesSchema, valueTypeSchema } from '../schemas.ts';
import type { Json, NodeDef, Values } from '../types.ts';

const CATEGORY = 'Tables';

export const CONDITION_OPS = [
  'is',
  'isNot',
  'oneOf',
  'notOneOf',
  'gt',
  'gte',
  'lt',
  'lte',
  'startsWith',
  'empty',
  'present'
] as const;

export type ConditionOp = (typeof CONDITION_OPS)[number];

const conditionSchema = v.strictObject({
  op: v.picklist(CONDITION_OPS),
  value: v.exactOptional(jsonSchema)
});

export type Condition = v.InferOutput<typeof conditionSchema>;

const lookupConfig = v.object({
  type: v.optional(valueTypeSchema, 'string'),
  rows: v.pipe(
    v.array(v.strictObject({ key: v.string(), value: jsonSchema })),
    v.check(
      (rows) => new Set(rows.map((r) => r.key)).size === rows.length,
      'Each key can appear once'
    )
  ),
  fallback: v.optional(jsonSchema)
});

const decideConfig = v.pipe(
  v.object({
    inputs: fieldsSchema,
    outputs: fieldsSchema,
    rules: v.array(
      v.strictObject({
        label: v.pipe(v.string(), v.trim(), v.nonEmpty()),
        when: v.record(v.string(), conditionSchema),
        set: v.optional(valuesSchema)
      })
    ),
    otherwise: v.optional(valuesSchema)
  }),
  v.check(
    ({ inputs, outputs }) =>
      !outputs.some((o) => o.name === 'rule' || o.name === 'rules' || o.name === 'matched') &&
      inputs.length > 0,
    'Add at least one input, and do not name outputs rule, rules or matched'
  ),
  v.check(
    ({ inputs, outputs, rules, otherwise }) =>
      rules.every(
        (r) =>
          Object.keys(r.when).every((k) => inputs.some((i) => i.name === k)) &&
          Object.keys(r.set ?? {}).every((k) => outputs.some((o) => o.name === k))
      ) && Object.keys(otherwise ?? {}).every((k) => outputs.some((o) => o.name === k)),
    'Rules may only test the inputs and set the outputs the table declares'
  )
);

type DecideConfig = v.InferOutput<typeof decideConfig>;

const numberOf = (x: Json) => {
  const n = typeof x === 'number' ? x : typeof x === 'string' && x.trim() ? Number(x) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};

const isEmpty = (x: Json) => x === null || x === '' || (Array.isArray(x) && x.length === 0);

const anyOf = (x: Json, test: (item: Json) => boolean) =>
  Array.isArray(x) ? x.some(test) : test(x);

const compare = (x: Json, value: Json, fn: (a: number, b: number) => boolean) =>
  anyOf(x, (item) => {
    const [a, b] = [numberOf(item), numberOf(value)];
    if (a !== null && b !== null) return fn(a, b);
    return typeof item === 'string' && typeof value === 'string'
      ? fn(item.localeCompare(value), 0)
      : false;
  });

const options = (value: Json) => (Array.isArray(value) ? value : [value]).map(toText);

export const holds = ({ op, value = null }: Condition, x: Json): boolean => {
  switch (op) {
    case 'is':
      return value === null ? isEmpty(x) : anyOf(x, (item) => toText(item) === toText(value));
    case 'isNot':
      return !holds({ op: 'is', value }, x);
    case 'oneOf':
      return anyOf(x, (item) => options(value).includes(toText(item)));
    case 'notOneOf':
      return !holds({ op: 'oneOf', value }, x);
    case 'gt':
      return compare(x, value, (a, b) => a > b);
    case 'gte':
      return compare(x, value, (a, b) => a >= b);
    case 'lt':
      return compare(x, value, (a, b) => a < b);
    case 'lte':
      return compare(x, value, (a, b) => a <= b);
    case 'startsWith':
      return anyOf(x, (item) => options(value).some((o) => o !== '' && toText(item).startsWith(o)));
    case 'empty':
      return isEmpty(x);
    case 'present':
      return !isEmpty(x);
  }
};

export const decide = (config: DecideConfig, inputs: Values): Values => {
  const hits = config.rules.filter((r) =>
    Object.entries(r.when).every(([k, c]) => holds(c, inputs[k] ?? null))
  );
  const [first] = hits;
  const values = (first ? first.set : config.otherwise) ?? {};
  return {
    ...Object.fromEntries(config.outputs.map((o) => [o.name, values[o.name] ?? null])),
    rule: first?.label ?? null,
    rules: hits.map((r) => r.label),
    matched: first !== undefined
  };
};

export const tableNodes: NodeDef[] = [
  pureNode<v.InferOutput<typeof lookupConfig>>({
    type: 'std.table.lookup',
    title: 'Lookup Table',
    category: CATEGORY,
    description:
      'Looks a key up in a table you fill in, such as a code and its meaning, and outputs its value, or the fallback when the key is not listed.',
    config: lookupConfig,
    inputs: [pin('key', 'any', { optional: true })],
    outputs: ({ type }) => [pin('value', type), pin('found', 'boolean')],
    compute: ({ key }, { rows, fallback }) => {
      const row = rows.find((r) => r.key === toText(key ?? null));
      return { value: row ? row.value : (fallback ?? null), found: row !== undefined };
    }
  }),
  pureNode<DecideConfig>({
    type: 'std.table.decide',
    title: 'Decision Table',
    category: CATEGORY,
    description:
      'Checks rules from top to bottom and outputs the values of the first rule whose conditions all hold, or the otherwise values. Also outputs the matching rule and every rule that held, as reasons.',
    config: decideConfig,
    inputs: ({ inputs }) =>
      inputs.map((f) =>
        pin(f.name, f.type, { optional: true, ...(f.label ? { label: f.label } : {}) })
      ),
    outputs: ({ outputs }) => [
      ...outputs.map((f) => pin(f.name, f.type, f.label ? { label: f.label } : {})),
      pin('rule', 'string', { label: 'Matching rule' }),
      pin('rules', { list: 'string' }, { label: 'Every rule that held' }),
      pin('matched', 'boolean')
    ],
    compute: (inputs, config) => decide(config, inputs)
  })
];
