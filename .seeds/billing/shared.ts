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

export const LOCATION = encounterModel('location');

export const INSURANCE = encounterModel('insurance');

export const PAYMENT = encounterModel('payment');

export const TIMES = encounterModel('times');

export const ODOMETER = encounterModel('odometer');

export const listOf = (type: ValueType): ValueType => ({ list: type });

export const ID = {
  claim: { id: 'claim' },
  encounter: { id: 'encounter' },
  patient: { id: 'patient' },
  payer: { id: 'payer' },
  report: { id: 'report' }
} as const;

export const T = {
  encounter: modelType(ENCOUNTER),
  person: modelType(PERSON),
  insurance: modelType(INSURANCE),
  claim: modelType(CLAIM),
  coverage: modelType(COVERAGE),
  chargeLine: modelType(CHARGE_LINE),
  blob: { object: { bucket: 'string', key: 'string' } }
} satisfies Record<string, ValueType>;

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

export type Test = { field: string; op: string; value?: Json; input?: string };

type Fixed = { value: Json };

export const fixed = (value: Json): Fixed => ({ value });

const ACRONYMS: Record<string, string> = { als: 'ALS', als2: 'ALS2', iv: 'IV', pcr: 'PCR' };

const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or']);

const words = (name: string) =>
  name
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

const labelOf = (name: string) =>
  words(name)
    .map(
      (w, i) => ACRONYMS[w] ?? (i > 0 && MINOR.has(w) ? w : `${w[0]?.toUpperCase()}${w.slice(1)}`)
    )
    .join(' ');

type Inputs = Record<string, [ValueType, Port]>;

const typed = (fields: Inputs) =>
  Object.entries(fields).map(([name, [type]]) => ({ name, type, label: labelOf(name) }));

const wireAll = (g: Builder, id: string, fields: Inputs) => {
  for (const [name, [, port]] of Object.entries(fields)) g.wire(port, `${id}.${name}`);
};

export const condition = (
  g: Builder,
  id: string,
  label: string,
  inputs: Inputs,
  rules: Test[],
  match: 'all' | 'any' = 'all'
) => {
  g.add(id, 'std.logic.condition', {
    label,
    config: { ...(match === 'any' ? { match } : {}), inputs: typed(inputs), rules } as Json
  });
  wireAll(g, id, inputs);
  return `${id}.result` as const;
};

export const select = (
  g: Builder,
  id: string,
  label: string,
  when: Port,
  whenTrue: Port | Fixed,
  whenFalse?: Port | Fixed
) => {
  const pins = { condition: when, whenTrue, whenFalse };
  const values = Object.fromEntries(
    Object.entries(pins).flatMap(([pin, from]) =>
      from && typeof from !== 'string' ? [[pin, from.value]] : []
    )
  );
  g.add(id, 'std.logic.select', { label, ...(Object.keys(values).length ? { values } : {}) });
  for (const [pin, from] of Object.entries(pins)) {
    if (typeof from === 'string') g.wire(from, `${id}.${pin}`);
  }
  return `${id}.result` as const;
};

export const firstSet = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  options: (Port | Fixed)[]
) => {
  const values = Object.fromEntries(
    options.flatMap((o, i) => (typeof o === 'string' ? [] : [[`option${i + 1}`, o.value]]))
  );
  g.add(id, 'std.logic.choose', {
    label,
    config: { mode: 'first', type, count: options.length },
    ...(Object.keys(values).length ? { values } : {})
  });
  for (const [i, o] of options.entries()) {
    if (typeof o === 'string') g.wire(o, `${id}.option${i + 1}`);
  }
  return `${id}.value` as const;
};

type Case = { id: string; label: string; when: Port; value: Port | Fixed };

export const firstThatHolds = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  cases: Case[],
  otherwise: Port | Fixed
) =>
  firstSet(g, id, label, type, [
    ...cases.map((c) => select(g, c.id, c.label, c.when, c.value)),
    otherwise
  ]);

export const either = (g: Builder, id: string, label: string, ports: Port[]) => {
  const [first, ...rest] = ports;
  if (!first) throw new Error(`${id} needs a test`);
  return rest.reduce<Port>((acc, port, i) => {
    const gate = rest.length === 1 ? id : `${id}${i + 1}`;
    g.add(gate, 'std.logic.or', { label });
    g.wire(acc, `${gate}.a`);
    g.wire(port, `${gate}.b`);
    return `${gate}.result`;
  }, first);
};

export const makeList = (g: Builder, id: string, label: string, type: ValueType, items: Port[]) => {
  g.add(id, 'std.list.make', { label, config: { count: items.length, type } });
  for (const [i, port] of items.entries()) g.wire(port, `${id}.item${i + 1}`);
  return `${id}.list` as const;
};

export const presentOf = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  items: Port[]
) => {
  const all = makeList(g, `${id}Or`, `${label} or Nothing`, type, items);
  g.add(id, 'std.list.compact', { label });
  g.wire(all, `${id}.list`);
  return `${id}.list` as const;
};

export const joinLists = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  lists: Port[]
) => {
  g.add(id, 'std.list.join', { label, config: { count: lists.length, type } });
  for (const [i, port] of lists.entries()) g.wire(port, `${id}.list${i + 1}`);
  return `${id}.list` as const;
};

export type Reason = { id: string; label: string; when: Port; reason: string };

export const reasonsOf = (g: Builder, id: string, label: string, reasons: Reason[]) =>
  presentOf(
    g,
    id,
    label,
    'string',
    reasons.map((r) => select(g, r.id, r.label, r.when, fixed(r.reason)))
  );

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
  rows: Record<string, string>,
  fallback?: string
) =>
  shared.lookup(key, name, description, {
    type: 'string',
    rows: Object.entries(rows).map(([k, value]) => ({ key: k, value })),
    ...(fallback === undefined ? {} : { fallback })
  });

export const lookup = (g: Builder, id: string, label: string, table: CodeTable, key: Port) => {
  g.add(id, 'std.table.lookup', { label, config: table.lookup });
  g.wire(key, `${id}.key`);
  return id;
};

export const keepWhere = (
  g: Builder,
  id: string,
  label: string,
  list: Port,
  config: Record<string, Json>
) => {
  g.add(id, 'std.list.where', { label, config });
  g.wire(list, `${id}.list`);
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
  g.add('label', 'std.text.template', {
    label: 'Choice Label',
    config: { template: label.template }
  });
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
  for (const name of Object.keys(candidate.fields).filter((n) =>
    label.template.includes(`{${n}}`)
  )) {
    g.wire(`parts.${name}`, `label.${name}`);
  }
  g.wire(`parts.${candidate.value}`, 'choice.value');
  g.wire('label.text', 'choice.label');
  g.ret('return');
  g.wire('choice.object', 'return.choice');
  return g.def;
};

export const choicesFor = (
  g: Builder,
  id: string,
  label: string,
  rule: string,
  field: string,
  candidates: Port
) => {
  g.add(`${id}List`, 'std.list.map-rule', {
    label: `${label} as Choices`,
    config: { rule, version: 1, item: 'candidate' }
  });
  g.add(id, 'std.object.make', {
    label,
    config: { fields: [{ name: field, type: listOf(CHOICE) }] } as Json
  });
  g.wire(candidates, `${id}List.list`);
  g.wire(`${id}List.choice`, `${id}.${field}`);
  return `${id}.object` as const;
};
