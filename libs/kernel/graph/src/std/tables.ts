import * as v from 'valibot';
import { pin, pureNode } from '../define.ts';
import { isRecord, toText } from '../json.ts';
import { fieldsSchema, jsonSchema, valuesSchema, valueTypeSchema } from '../schemas.ts';
import type { GraphDef, Json, NodeDef, NodeInstance, Values } from '../types.ts';

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

type Condition = v.InferOutput<typeof conditionSchema>;

export const TABLE_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

const tableRefSchema = v.strictObject({
  key: v.pipe(v.string(), v.regex(TABLE_KEY_PATTERN, 'Use a dotted lowercase table key'))
});

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

const hasFields = ({ inputs, outputs }: { inputs: unknown[]; outputs: { name: string }[] }) =>
  !outputs.some((o) => o.name === 'rule' || o.name === 'rules' || o.name === 'matched') &&
  inputs.length > 0;

const FIELDS_MESSAGE = 'Add at least one input, and do not name outputs rule, rules or matched';

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
  v.check((c) => hasFields(c), FIELDS_MESSAGE),
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

type LookupConfig = v.InferOutput<typeof lookupConfig>;

const lookupRef = v.strictObject({
  type: v.optional(valueTypeSchema, 'string'),
  table: tableRefSchema
});

const decideRef = v.pipe(
  v.strictObject({ inputs: fieldsSchema, outputs: fieldsSchema, table: tableRefSchema }),
  v.check((c) => hasFields(c), FIELDS_MESSAGE)
);

export const TABLE_NODE_KINDS = {
  'std.table.decide': 'decide',
  'std.table.lookup': 'lookup'
} as const;

export type TableKind = (typeof TABLE_NODE_KINDS)[keyof typeof TABLE_NODE_KINDS];

export const tableSchemas = { decide: decideConfig, lookup: lookupConfig } as const;

const fieldContract = (fields: readonly { name: string; type: Json }[]) =>
  fields.map((f) => [f.name, f.type]);

const contractOfFields = (c: Record<string, unknown>) =>
  JSON.stringify(
    'inputs' in c
      ? [
          fieldContract(c.inputs as { name: string; type: Json }[]),
          fieldContract(c.outputs as { name: string; type: Json }[])
        ]
      : [(c.type as Json | undefined) ?? 'string']
  );

export const tableContract = (definition: Json) =>
  isRecord(definition) ? contractOfFields(definition) : '';

const tableKindOf = (type: string): TableKind | undefined =>
  Object.hasOwn(TABLE_NODE_KINDS, type)
    ? TABLE_NODE_KINDS[type as keyof typeof TABLE_NODE_KINDS]
    : undefined;

export const tableRefOf = (node: NodeInstance) => {
  const kind = tableKindOf(node.type);
  const table = isRecord(node.config) ? node.config.table : undefined;
  return kind && isRecord(table) && typeof table.key === 'string' ? { kind, key: table.key } : null;
};

export const tableRefs = (def: GraphDef) => [
  ...new Set(def.nodes.flatMap((n) => tableRefOf(n)?.key ?? []))
];

export type ResolvedTable = { kind: TableKind; definition: Json };

const inlined = (config: Record<string, Json>, table: Record<string, Json>): Json => {
  const { table: _, ...own } = config;
  return 'inputs' in own
    ? {
        ...own,
        rules: table.rules ?? [],
        ...(table.otherwise ? { otherwise: table.otherwise } : {})
      }
    : {
        ...own,
        rows: table.rows ?? [],
        ...(table.fallback === undefined ? {} : { fallback: table.fallback })
      };
};

export const inlineTables = (
  def: GraphDef,
  resolve: (key: string) => ResolvedTable | undefined
): GraphDef => {
  if (!def.nodes.some((n) => tableRefOf(n))) return def;
  return {
    ...def,
    nodes: def.nodes.map((n) => {
      const ref = tableRefOf(n);
      const table = ref ? resolve(ref.key) : undefined;
      if (!ref || !table || table.kind !== ref.kind || !isRecord(table.definition)) return n;
      const config = n.config as Record<string, Json>;
      return tableContract(table.definition) === contractOfFields(config)
        ? { ...n, config: inlined(config, table.definition) }
        : n;
    })
  };
};

const unresolved = (key: string) =>
  new Error(`The table ${key} is not available to this run, or no longer has these fields`);

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
  pureNode<LookupConfig | v.InferOutput<typeof lookupRef>>({
    type: 'std.table.lookup',
    title: 'Lookup Table',
    category: CATEGORY,
    description:
      'Looks a key up in a table you fill in, or a shared table, such as a code and its meaning, and outputs its value, or the fallback when the key is not listed.',
    config: v.union([lookupRef, lookupConfig]),
    inputs: [pin('key', 'any', { optional: true })],
    outputs: ({ type }) => [pin('value', type), pin('found', 'boolean')],
    compute: ({ key }, config) => {
      if ('table' in config) throw unresolved(config.table.key);
      const row = config.rows.find((r) => r.key === toText(key ?? null));
      return { value: row ? row.value : (config.fallback ?? null), found: row !== undefined };
    }
  }),
  pureNode<DecideConfig | v.InferOutput<typeof decideRef>>({
    type: 'std.table.decide',
    title: 'Decision Table',
    category: CATEGORY,
    description:
      'Checks rules from top to bottom, its own or a shared table, and outputs the values of the first rule whose conditions all hold, or the otherwise values. Also outputs the matching rule and every rule that held, as reasons.',
    config: v.union([decideRef, decideConfig]),
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
    compute: (inputs, config) => {
      if ('table' in config) throw unresolved(config.table.key);
      return decide(config, inputs);
    }
  })
];
