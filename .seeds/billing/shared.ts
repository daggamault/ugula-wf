import { billingTypes } from '@ugula/billing';
import type { ExitDoc, GraphDef, Json, PinSpec, ValueType, VariableDef } from '@ugula/graph';
import { PCR_TYPE } from '@ugula/nemsis';
import { createTables, graph } from '../builder.ts';
import type { SeedGraph } from '../graphs.ts';
import { p } from './glossary.ts';

export const T = { ...billingTypes, pcr: PCR_TYPE };

export const ADDRESS_PINS = ['addressLine', 'city', 'state', 'postalCode'];

export const CHARGE_LINES: ValueType = {
  list: { object: { code: { code: 'hcpcs' }, units: 'number' } }
};

export const FEES: ValueType = { object: {} };

export type Builder = ReturnType<typeof graph>;

export const shared = createTables();

export const d = (
  name: string,
  type: ValueType,
  label: string,
  description: string,
  optional = false
): PinSpec => ({ name, type, label, description, ...(optional ? { optional: true } : {}) });

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

export type Field = { name: string; type: ValueType; label: string };

export const field = (name: string, type: ValueType, label: string): Field => ({
  name,
  type,
  label
});

type Rule = { label: string; when?: Record<string, Json>; set?: Record<string, Json> };

export const table = (
  inputs: Field[],
  outputs: Field[],
  rules: Rule[],
  otherwise: Record<string, Json> = {},
  otherwiseLabel?: string
) => ({
  inputs,
  outputs,
  rules: rules.map((r) => ({ label: r.label, when: r.when ?? {}, set: r.set ?? {} })),
  otherwise,
  ...(otherwiseLabel ? { otherwiseLabel } : {})
});

export const is = (value: Json) => ({ op: 'is', value });

export type Port = `${string}.${string}`;

export type Test = { field: string; op: string; value?: Json; input?: string };

export type Fixed = { value: Json };

export const fixed = (value: Json): Fixed => ({ value });

const ACRONYMS: Record<string, string> = {
  abn: 'ABN',
  als: 'ALS',
  cms: 'CMS',
  hcpcs: 'HCPCS',
  id: 'ID',
  msp: 'MSP',
  npi: 'NPI',
  pcr: 'PCR',
  pcs: 'PCS',
  utn: 'UTN',
  zip: 'ZIP',
  zip4: 'ZIP+4'
};

const MINOR = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'of', 'on', 'or']);

const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());

export const labelOf = (name: string) =>
  words(name)
    .map(
      (w, i) => ACRONYMS[w] ?? (i > 0 && MINOR.has(w) ? w : `${w[0]?.toUpperCase()}${w.slice(1)}`)
    )
    .join(' ');

const hasAcronym = (name: string) => words(name).some((w) => w in ACRONYMS);

const typed = (fields: Record<string, [ValueType, Port]>) =>
  Object.entries(fields).map(([name, [type]]) => ({
    name,
    type,
    ...(hasAcronym(name) ? { label: labelOf(name) } : {})
  }));

const wireAll = (g: Builder, id: string, fields: Record<string, [ValueType, Port]>) => {
  for (const [name, [, port]] of Object.entries(fields)) g.wire(port, `${id}.${name}`);
};

export const condition = (
  g: Builder,
  id: string,
  label: string,
  inputs: Record<string, [ValueType, Port]>,
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
  whenTrue?: Port | Fixed,
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

export type Case = { id: string; label: string; when: Port; value: Port | Fixed };

export const firstOf = (
  g: Builder,
  id: string,
  label: string,
  type: ValueType,
  cases: Case[],
  otherwise: Port | Fixed
) => {
  const fallback =
    typeof otherwise === 'string' ? {} : { [`option${cases.length + 1}`]: otherwise.value };
  g.add(id, 'std.logic.choose', {
    label,
    config: { mode: 'first', type, count: cases.length + 1 },
    ...(Object.keys(fallback).length ? { values: fallback } : {})
  });
  for (const [i, c] of cases.entries()) {
    g.wire(select(g, c.id, c.label, c.when, c.value), `${id}.option${i + 1}`);
  }
  if (typeof otherwise === 'string') g.wire(otherwise, `${id}.option${cases.length + 1}`);
  return `${id}.value` as const;
};

export const reasonsOf = (
  g: Builder,
  id: string,
  label: string,
  reasons: { id: string; label: string; when: Port; reason: string }[]
) =>
  makeList(
    g,
    id,
    label,
    'string',
    reasons.map((r) => select(g, r.id, r.label, r.when, fixed(r.reason)))
  );

export const orElse = (
  g: Builder,
  id: string,
  label: string,
  value: Port,
  fallback: Port | Fixed,
  type: ValueType = 'string'
) => {
  g.add(id, 'std.logic.choose', {
    label,
    config: { mode: 'first', type, count: 2 },
    ...(typeof fallback === 'string' ? {} : { values: { option2: fallback.value } })
  });
  g.wire(value, `${id}.option1`);
  if (typeof fallback === 'string') g.wire(fallback, `${id}.option2`);
  return `${id}.value` as const;
};

export const makeObject = (
  g: Builder,
  id: string,
  label: string,
  fields: Record<string, [ValueType, Port]>
) => {
  g.add(id, 'std.object.make', { label, config: { fields: typed(fields) } as Json });
  wireAll(g, id, fields);
  return `${id}.object` as const;
};

export const makeList = (g: Builder, id: string, label: string, type: ValueType, items: Port[]) => {
  g.add(id, 'std.list.make', { label, config: { count: items.length, type } });
  for (const [i, port] of items.entries()) g.wire(port, `${id}.item${i + 1}`);
  return `${id}.list` as const;
};

export const getField = (
  g: Builder,
  id: string,
  label: string,
  record: ValueType,
  path: string,
  from: Port
) => {
  g.add(id, 'std.object.get-field', { label, config: { record, path } });
  g.wire(from, `${id}.record`);
  return `${id}.value` as const;
};

export const joinText = (g: Builder, id: string, label: string, separator: string, items: Port) => {
  g.add(id, 'std.text.join', { label, values: { separator } });
  g.wire(items, `${id}.items`);
  return `${id}.text` as const;
};

export const money = (g: Builder, id: string, label: string, cents: Port) => {
  g.add(id, 'std.text.money', { label });
  g.wire(cents, `${id}.cents`);
  return `${id}.text` as const;
};

export const recordEvent = (
  g: Builder,
  id: string,
  kind: string,
  label: string,
  more: Record<string, Json> = {}
) => g.add(id, 'billing.record-claim-event', { label, values: { kind, ...more } });

export const template = (
  g: Builder,
  id: string,
  label: string,
  text: string,
  from: Record<string, Port> = {}
) => {
  g.add(id, 'std.text.template', { label, config: { template: text } });
  for (const [pin, port] of Object.entries(from)) g.wire(port, `${id}.${pin}`);
  return `${id}.text` as const;
};

export const summary = (g: Builder, task: string, text: string, from: Record<string, Port>) =>
  g.wire(template(g, `${task}Summary`, 'Task Summary', text, from), `${task}.summary`);

export const P = {
  pcr: (optional = false) => p('pcr', PCR_TYPE, optional),
  facts: (optional = false) => p('facts', T.facts, optional),
  claimId: () => p('claimId', { id: 'claim' }),
  report: (optional = true) => p('report', T.blob, optional),
  classification: (optional = false) => p('classification', 'string', optional),
  reason: () =>
    d(
      'reason',
      'string',
      'Classified By',
      'The Classification rule that matched, or nothing when none did.',
      true
    ),
  service: (optional = false) => p('service', T.service, optional),
  findings: (optional = false) => p('findings', T.findings, optional),
  patient: (optional = false) => p('patient', T.patient, optional),
  coverages: (description?: string) => ({
    ...p('coverages', T.coverages),
    ...(description ? { description } : {})
  }),
  subject: () => p('subject', 'string', true),
  context: () => p('context', 'any', true),
  coverageId: () => p('coverageId', { id: 'coverage' }, true),
  reasons: (what: string) =>
    d(
      'reasons',
      { list: 'string' },
      'Reasons',
      `Every rule that held, so a biller sees why ${what}.`
    ),
  issues: (description = 'Issues found, each with its code, severity, message and field to fix.') =>
    d('issues', T.issues, 'Issues', description)
};

export const listItem = (type: ValueType) => (type as { list: ValueType }).list;

export const tableOf = (lookup: Json) => (lookup as { table: Json }).table;

export const codeSet = (
  key: string,
  name: string,
  description: string,
  codes: Record<string, string>
) =>
  shared.lookup(key, name, description, {
    type: 'string',
    rows: Object.entries(codes).map(([k, value]) => ({ key: k, value }))
  });

export const MEDICARE_CLAIM_FILINGS = codeSet(
  'billing.medicare-claim-filings',
  'Medicare Claim Filings',
  'The claim filing indicators that make a payer Medicare, so the Medicare-only rules apply to it: MA for Part A and MB for Part B.',
  { MA: 'Medicare Part A', MB: 'Medicare Part B' }
);

export const MEDICAID_CLAIM_FILINGS = codeSet(
  'billing.medicaid-claim-filings',
  'Medicaid Claim Filings',
  'The claim filing indicators that make a payer Medicaid, so a claim with both Medicare and Medicaid marks the patient dual eligible: MC for Medicaid.',
  { MC: 'Medicaid' }
);

export const isListed = (g: Builder, id: string, label: string, lookup: Json, key: Port) => {
  g.add(id, 'std.table.lookup', { label, config: lookup });
  g.wire(key, `${id}.key`);
  return `${id}.found` as const;
};

export const keepListed = (
  g: Builder,
  id: string,
  label: string,
  lookup: Json,
  list: Port,
  field = '',
  op: 'listed' | 'notListed' = 'listed'
) => {
  g.add(id, 'std.list.where', { label, config: { field, op, table: tableOf(lookup) } as Json });
  g.wire(list, `${id}.list`);
  return `${id}.list` as const;
};

const gate = (type: 'and' | 'or') => (g: Builder, id: string, label: string, a: Port, b: Port) => {
  g.add(id, `std.logic.${type}`, { label });
  g.wire(a, `${id}.a`);
  g.wire(b, `${id}.b`);
  return `${id}.result` as const;
};

export const both = gate('and');

export const either = gate('or');

export const CLAIM_DATA_DENIALS = codeSet(
  'billing.claim-data-denials',
  'Claim Data Denials',
  'The group and reason codes (CARC) that mean the payer needs corrected or missing claim data, so Route Remittance sends the denial to be fixed and Denial Category suggests correcting the claim.',
  {
    'CO-4':
      'The procedure code is inconsistent with the modifier used, or a required modifier is missing',
    'CO-11': 'The diagnosis is inconsistent with the procedure',
    'CO-16': 'Claim or service lacks information or has submission or billing errors',
    'CO-146': 'Diagnosis was invalid for the date of service reported',
    'CO-181': 'Procedure code was invalid on the date of service',
    'CO-182': 'Procedure modifier was invalid on the date of service'
  }
);
