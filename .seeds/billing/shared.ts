import { CHARGE_LINE, CLAIM, COVERAGE } from '@ugula/billing';
import {
  type ExitDoc,
  type GraphDef,
  type Json,
  type Model,
  modelType,
  type PinSpec,
  type ValueType,
  type VariableDef
} from '@ugula/graph';
import { encounterModels } from '@ugula/nemsis';
import { createTables, graph } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';

const encounterModel = (key: string): Model => {
  const found = encounterModels.find((m) => m.key === key);
  if (!found) throw new Error(`No encounter model ${key}`);
  return found;
};

export const ENCOUNTER = encounterModel('encounter');

export const PERSON = encounterModel('person');

export const SCENE = encounterModel('scene');

export const DESTINATION = encounterModel('destination');

export const INSURANCE = encounterModel('insurance');

export const PAYMENT = encounterModel('payment');

export const MEDICATION = encounterModel('medication');

export const PROCEDURE = encounterModel('procedure');

export const TIMES = encounterModel('times');

export const ODOMETER = encounterModel('odometer');

export const listOf = (type: ValueType): ValueType => ({ list: type });

export const code = (kind: string): ValueType => ({ code: kind });

export const ID = {
  claim: { id: 'claim' },
  encounter: { id: 'encounter' },
  import: { id: 'import' },
  patient: { id: 'patient' },
  payer: { id: 'payer' },
  report: { id: 'report' }
} as const;

export const T = {
  encounter: modelType(ENCOUNTER),
  person: modelType(PERSON),
  insurance: modelType(INSURANCE),
  medication: modelType(MEDICATION),
  procedure: modelType(PROCEDURE),
  claim: modelType(CLAIM),
  coverage: modelType(COVERAGE),
  chargeLine: modelType(CHARGE_LINE),
  blob: { object: { bucket: 'string', key: 'string' } }
} satisfies Record<string, ValueType>;

export const CODE = {
  classification: code('tripClassification'),
  level: code('levelOfService'),
  place: code('placeCode'),
  hcpcs: code('hcpcs'),
  modifier: code('modifier')
} as const;

export const QUEUE = 'billing';

export const SERVICE_TYPES = {
  leavingHospital: ['2205005', '2205015'],
  leavingCare: ['2205017', '2205019'],
  scheduled: ['2205007'],
  emergency: ['2205001', '2205003', '2205009']
} as const;

export const INTERFACILITY = [...SERVICE_TYPES.leavingHospital, ...SERVICE_TYPES.leavingCare];

export type Builder = ReturnType<typeof graph>;

export type Port = `${string}.${string}`;

export const shared = createTables();

export const d = (
  name: string,
  type: ValueType,
  label: string,
  description: string,
  optional = false
): PinSpec => ({ name, type, label, description, ...(optional ? { optional: true } : {}) });

export const reasonsOut = (what: string) =>
  d('reasons', listOf('string'), 'Reasons', `Every rule that held, so a biller sees why ${what}.`);

export const exit = (label: string, description: string): ExitDoc => ({ label, description });

export const rule = (inputs: PinSpec[], outputs: PinSpec[]) =>
  graph({ execIn: [], execOut: [], inputs, outputs });

export const stage = (
  inputs: PinSpec[],
  outputs: PinSpec[],
  exits: Record<string, ExitDoc>,
  variables: VariableDef[] = []
) => graph({ execIn: ['exec'], execOut: Object.keys(exits), inputs, outputs, exits }, variables);

export const flow = (inputs: PinSpec[], outputs: PinSpec[], variables: VariableDef[] = []) =>
  graph({ execIn: ['exec'], execOut: [], inputs, outputs }, variables);

const seed =
  (kind: SeedGraph['kind'], role: SeedGraph['role']) =>
  (key: string, name: string, description: string, definition: GraphDef): SeedGraph => ({
    key,
    name,
    kind,
    role,
    description,
    version: 1,
    definition
  });

export const asRule = seed('node', 'rule');

export const asStage = seed('node', 'stage');

export const asWorkflow = seed('workflow', 'workflow');

type Fixed = { value: Json };

export type Source = Port | Fixed;

export const fixed = (value: Json): Fixed => ({ value });

const outputOf = (id: string, pin: string): Port => `${id}.${pin}`;

export const node = (
  g: Builder,
  id: string,
  type: string,
  label: string,
  inputs: Record<string, Source | undefined> = {},
  config?: Json
) => {
  const given = Object.entries(inputs).filter((e): e is [string, Source] => e[1] !== undefined);
  const values = Object.fromEntries(
    given.flatMap(([pin, from]) => (typeof from === 'string' ? [] : [[pin, from.value]]))
  );
  g.add(id, type, {
    label,
    ...(config === undefined ? {} : { config }),
    ...(Object.keys(values).length ? { values } : {})
  });
  for (const [pin, from] of given) if (typeof from === 'string') g.wire(from, `${id}.${pin}`);
  return id;
};

const numbered = (prefix: string, sources: Source[]) =>
  Object.fromEntries(sources.map((s, i) => [`${prefix}${i + 1}`, s]));

export const codes = (
  g: Builder,
  id: string,
  label: string,
  kind: string,
  values: readonly string[]
) => {
  node(g, id, 'std.value', label, {}, { type: listOf(code(kind)), value: [...values] });
  return outputOf(id, 'value');
};

export const isIn = (
  g: Builder,
  id: string,
  label: string,
  kind: string,
  item: Port,
  list: Port
) => {
  node(g, id, 'std.list.contains', label, { list, item }, { type: code(kind) });
  return outputOf(id, 'result');
};

export const isCode = (
  g: Builder,
  id: string,
  label: string,
  kind: string,
  item: Port,
  value: string
) => {
  node(g, id, 'std.logic.equal', label, { a: item, b: fixed(value) }, { type: code(kind) });
  return outputOf(id, 'result');
};

export const isText = (g: Builder, id: string, label: string, item: Port, value: string) => {
  node(g, id, 'std.logic.equal', label, { a: item, b: fixed(value) }, { type: 'string' });
  return outputOf(id, 'result');
};

export const orZero = (g: Builder, id: string, label: string, value: Port) => {
  node(g, id, 'std.logic.coalesce', label, { value, fallback: fixed(0) }, { type: 'number' });
  return outputOf(id, 'result');
};

export const template = (
  g: Builder,
  id: string,
  label: string,
  text: string,
  values: Record<string, Port>
) => {
  node(g, id, 'std.text.template', label, values, { template: text });
  return outputOf(id, 'text');
};

export const isZero = (g: Builder, id: string, label: string, value: Port) => {
  node(g, id, 'std.logic.equal', label, { a: value, b: fixed(0) }, { type: 'integer' });
  return outputOf(id, 'result');
};

export const not = (g: Builder, id: string, label: string, value: Port) => {
  node(g, id, 'std.logic.not', label, { value });
  return outputOf(id, 'result');
};

export const isMissing = (g: Builder, id: string, label: string, value: Port) => {
  node(g, id, 'std.logic.is-null', label, { value });
  return outputOf(id, 'result');
};

export const atLeast = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  value: Port,
  least: number
) => {
  node(g, id, 'std.logic.greater-or-equal', label, { a: value, b: fixed(least) }, { type });
  return outputOf(id, 'result');
};

export const greaterThan = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  value: Port,
  than: number
) => {
  node(g, id, 'std.logic.greater', label, { a: value, b: fixed(than) }, { type });
  return outputOf(id, 'result');
};

export const startsWith = (g: Builder, id: string, label: string, text: Port, part: string) => {
  node(g, id, 'std.text.starts-with', label, { text, part: fixed(part) });
  return outputOf(id, 'result');
};

const gates = (gate: 'and' | 'or') => (g: Builder, id: string, label: string, ports: Port[]) => {
  const [first] = ports;
  if (!first) throw new Error(`${id} needs a condition`);
  if (ports.length === 1) return first;
  node(g, id, `std.logic.${gate}`, label, numbered('condition', ports), { count: ports.length });
  return outputOf(id, 'result');
};

export const allOf = gates('and');

export const anyOf = gates('or');

export const select = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  condition: Port,
  whenTrue: Source,
  whenFalse?: Source
) => {
  node(g, id, 'std.logic.select', label, { condition, whenTrue, whenFalse }, { type });
  return outputOf(id, 'result');
};

export const firstSet = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  options: Source[]
) => {
  const config = { mode: 'first', type, count: options.length };
  node(g, id, 'std.logic.choose', label, numbered('option', options), config);
  return outputOf(id, 'value');
};

export const makeList = (g: Builder, id: string, label: string, type: ValueType, items: Port[]) => {
  node(g, id, 'std.list.make', label, numbered('item', items), { count: items.length, type });
  return outputOf(id, 'list');
};

export const joinLists = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  lists: Port[]
) => {
  node(g, id, 'std.list.join', label, numbered('list', lists), { count: lists.length, type });
  return outputOf(id, 'list');
};

export type Criterion = { id: string; label: string; reason: string; holds: Port };

export const reasonsOf = (g: Builder, id: string, label: string, criteria: Criterion[]) =>
  makeList(
    g,
    id,
    label,
    'string',
    criteria.map((c) =>
      select(g, `${c.id}Reason`, `Reason When ${c.label}`, 'string', c.holds, fixed(c.reason))
    )
  );

export const CRITERIA_OUT = [
  d('holds', 'boolean', 'Holds', 'Whether any of the criteria holds.'),
  d('reasons', listOf('string'), 'Reasons', 'The reason of each criterion that holds.')
];

export const criteriaResult = (g: Builder, label: string, criteria: Criterion[]) => {
  const holds = anyOf(
    g,
    'any',
    `Any ${label} Criterion Holds`,
    criteria.map((c) => c.holds)
  );
  g.ret('return');
  g.wire(holds, 'return.holds');
  g.wire(reasonsOf(g, 'reasons', `${label} Reasons`, criteria), 'return.reasons');
  return g.def;
};

export const breakRecord = (
  g: Builder,
  id: string,
  label: string,
  model: Pick<Model, 'key' | 'name'>,
  from: Port
) => {
  g.add(id, `${model.key}.break`, { label });
  g.wire(from, `${id}.${model.name}`);
  return id;
};

export type CodeTable = ReturnType<typeof codeTable>;

export const codeTable = (
  key: string,
  name: string,
  description: string,
  type: ValueType,
  rows: Record<string, string>,
  fallback?: string
) =>
  shared.lookup(key, name, description, {
    type,
    rows: Object.entries(rows).map(([k, value]) => ({ key: k, value })),
    ...(fallback === undefined ? {} : { fallback })
  });

export const lookup = (g: Builder, id: string, label: string, table: CodeTable, key: Port) =>
  node(g, id, 'std.table.lookup', label, { key }, table.lookup);

export const keepWhere = (
  g: Builder,
  id: string,
  label: string,
  ruleKey: string,
  item: string,
  list: Port,
  given: Record<string, Source> = {}
) => {
  node(
    g,
    id,
    'std.list.filter-rule',
    label,
    { list, ...given },
    {
      rule: ruleKey,
      version: 1,
      item,
      test: 'result'
    }
  );
  return id;
};

const CHOICE = { object: { value: 'string', label: 'string' } } as const;

export const choiceRule = (
  candidate: { description: string; fields: Record<string, ValueType>; value: string },
  label: { template: string; description: string }
): GraphDef => {
  const g = rule(
    [d('candidate', { object: candidate.fields }, 'Candidate', candidate.description)],
    [d('choice', CHOICE, 'Choice', label.description)]
  );
  g.add('parts', 'std.object.break', {
    label: 'Candidate',
    config: {
      fields: Object.entries(candidate.fields).map(([name, type]) => ({ name, type }))
    } as Json
  });
  const shown = Object.keys(candidate.fields).filter((n) => label.template.includes(`{${n}}`));
  const text = template(
    g,
    'label',
    'Choice Label',
    label.template,
    Object.fromEntries(shown.map((n) => [n, `parts.${n}` as const]))
  );
  g.add('choice', 'std.object.make', {
    label: 'Choice',
    config: {
      fields: [
        { name: 'value', type: 'string' },
        { name: 'label', type: 'string' }
      ]
    } as Json
  });
  g.wire('entry.candidate', 'parts.object');
  g.wire(`parts.${candidate.value}`, 'choice.value');
  g.wire(text, 'choice.label');
  g.ret('return');
  g.wire('choice.object', 'return.choice');
  return g.def;
};

export const choicesFor = (
  g: Builder,
  id: string,
  label: string,
  ruleKey: string,
  field: string,
  candidates: Port
) => {
  g.add(`${id}List`, 'std.list.map-rule', {
    label: `${label} as Choices`,
    config: { rule: ruleKey, version: 1, item: 'candidate' }
  });
  g.add(id, 'std.object.make', {
    label,
    config: { fields: [{ name: field, type: listOf(CHOICE) }] } as Json
  });
  g.wire(candidates, `${id}List.list`);
  g.wire(`${id}List.choice`, `${id}.${field}`);
  return `${id}.object` as const;
};
