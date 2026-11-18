import {
  checkValue,
  ENTRY_TYPE,
  type EventDef,
  type ExitDoc,
  freeIdentifiers,
  type GraphDef,
  INPUT_TYPE,
  isRecord,
  type NodeInstance,
  type PinSpec,
  RETURN_TYPE,
  triggerOf,
  type ValueType
} from '@ugula/graph';
import type { Catalog } from './catalog.ts';
import { connectionKind, removeNodes } from './flow.ts';
import { pinLabel } from './pins.ts';

const execNames = (def: GraphDef, side: PinSide) =>
  side === 'inputs' ? def.signature.execIn : def.signature.execOut;

export type PinSide = 'inputs' | 'outputs';

const VARIABLE_NODES = new Set([
  'std.var.get',
  'std.var.set',
  'std.var.append',
  'std.var.increment'
]);

const RESERVED = new Set(Object.getOwnPropertyNames(Object.prototype));

export const keyFromName = (text: string, taken: readonly string[]) => {
  const words = text
    .normalize('NFKD')
    .replace(/[^\w\s]/g, ' ')
    .split(/[\s_]+/)
    .filter(Boolean);
  const camel = words
    .map((w, i) =>
      i === 0 ? w.charAt(0).toLowerCase() + w.slice(1) : w.charAt(0).toUpperCase() + w.slice(1)
    )
    .join('');
  const base = /^[A-Za-z_$]/.test(camel) && !RESERVED.has(camel) ? camel : `value${camel}`;
  const names = new Set(taken);
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base}${i}`)) return `${base}${i}`;
};

const configOf = (n: NodeInstance) => (isRecord(n.config) ? n.config : {});

const ids = (def: GraphDef, type: string) =>
  new Set(def.nodes.filter((n) => n.type === type).map((n) => n.id));

export const pinUsed = (def: GraphDef, side: PinSide, name: string) => {
  if (side === 'inputs') {
    const entries = ids(def, ENTRY_TYPE);
    return (
      def.edges.some((e) => entries.has(e.from) && e.fromPin === name) ||
      def.nodes.some((n) => n.type === INPUT_TYPE && configOf(n).pin === name)
    );
  }
  const returns = ids(def, RETURN_TYPE);
  return (
    def.edges.some((e) => returns.has(e.to) && e.toPin === name) ||
    def.nodes.some((n) => n.type === RETURN_TYPE && n.inputs?.[name] !== undefined)
  );
};

const renameKey = <T>(record: Record<string, T>, from: string, to: string) =>
  from in record
    ? Object.fromEntries(Object.entries(record).map(([k, v]) => [k === from ? to : k, v]))
    : record;

export const renamePin = (def: GraphDef, side: PinSide, from: string, to: string): GraphDef => {
  if (from === to) return def;
  const signature = {
    ...def.signature,
    [side]: def.signature[side].map((p) => (p.name === from ? { ...p, name: to } : p))
  };
  if (side === 'inputs') {
    const entries = ids(def, ENTRY_TYPE);
    return {
      ...def,
      signature,
      nodes: def.nodes.map((n) =>
        n.type === INPUT_TYPE && configOf(n).pin === from
          ? { ...n, config: { ...configOf(n), pin: to } }
          : n
      ),
      edges: def.edges.map((e) =>
        entries.has(e.from) && e.fromPin === from ? { ...e, fromPin: to } : e
      )
    };
  }
  const returns = ids(def, RETURN_TYPE);
  return {
    ...def,
    signature,
    nodes: def.nodes.map((n) => {
      if (n.type !== RETURN_TYPE || !n.inputs) return n;
      const inputs = renameKey(n.inputs, from, to);
      return inputs === n.inputs ? n : { ...n, inputs };
    }),
    edges: def.edges.map((e) => (returns.has(e.to) && e.toPin === from ? { ...e, toPin: to } : e))
  };
};

const eventFields = (def: GraphDef, events: readonly EventDef[]) => {
  const trigger = triggerOf(def);
  return trigger.kind === 'event'
    ? (events.find((e) => e.type === trigger.event)?.payload ?? [])
    : [];
};

export const eventSuggestions = (def: GraphDef, events: readonly EventDef[]) =>
  eventFields(def, events).filter((f) => !def.signature.inputs.some((p) => p.name === f.name));

export const namePin = (
  def: GraphDef,
  side: PinSide,
  index: number,
  text: string,
  events: readonly EventDef[] = []
): GraphDef => {
  const pins = def.signature[side];
  const pin = pins[index];
  const label = text.trim().replace(/\s+/g, ' ');
  if (!pin || !label) return def;
  const fromEvent = side === 'inputs' && eventFields(def, events).some((f) => f.name === pin.name);
  const others = [
    ...pins.filter((_, i) => i !== index).map((p) => p.name),
    ...execNames(def, side)
  ];
  const keep = fromEvent || pinUsed(def, side, pin.name);
  const name = keep ? pin.name : keyFromName(label, others);
  const renamed = renamePin(def, side, pin.name, name);
  const { label: _, ...rest } = { ...pin, name };
  const next: PinSpec = pinLabel({ name }) === label ? rest : { ...rest, label };
  return {
    ...renamed,
    signature: {
      ...renamed.signature,
      [side]: renamed.signature[side].map((p, i) => (i === index ? next : p))
    }
  };
};

export const nameTaken = (pins: readonly PinSpec[], index: number, text: string) => {
  const wanted = text.trim().toLowerCase();
  return pins.some((p, i) => i !== index && pinLabel(p).toLowerCase() === wanted);
};

const fits = (def: GraphDef, catalog: Catalog, e: GraphDef['edges'][number]) =>
  connectionKind(def, catalog, {
    source: e.from,
    sourceHandle: e.fromPin,
    target: e.to,
    targetHandle: e.toPin
  }) !== null;

export const dropUnfit = (before: GraphDef, def: GraphDef, catalog: Catalog) => {
  const edges = def.edges.filter((e) => fits(def, catalog, e) || !fits(before, catalog, e));
  const dropped = def.edges.length - edges.length;
  return { def: dropped ? { ...def, edges } : def, dropped };
};

export const retypePin = (
  def: GraphDef,
  catalog: Catalog,
  side: PinSide,
  index: number,
  type: ValueType
) => {
  const pins = def.signature[side].map((p, i) => {
    if (i !== index) return p;
    const { default: kept, ...rest } = p;
    return kept === undefined || checkValue(type, kept)
      ? { ...rest, type }
      : { ...rest, type, default: kept };
  });
  return dropUnfit(def, { ...def, signature: { ...def.signature, [side]: pins } }, catalog);
};

const exitUsed = (def: GraphDef, name: string) =>
  def.nodes.some((n) => n.type === RETURN_TYPE && configOf(n).pin === name);

const variableInExpressions = (def: GraphDef, name: string) =>
  def.nodes.some((n) =>
    Object.values(n.inputs ?? {}).some((b) => 'expr' in b && freeIdentifiers(b.expr).includes(name))
  );

export const renameVariable = (def: GraphDef, from: string, to: string): GraphDef =>
  from === to
    ? def
    : {
        ...def,
        variables: def.variables.map((v) => (v.name === from ? { ...v, name: to } : v)),
        nodes: def.nodes.map((n) =>
          VARIABLE_NODES.has(n.type) && configOf(n).name === from
            ? { ...n, config: { ...configOf(n), name: to } }
            : n
        )
      };

export type Exit = { name: string; label?: string | undefined; description?: string | undefined };

export const exitsOf = ({ execOut, exits = {} }: GraphDef['signature']): Exit[] =>
  execOut.map((name) => ({ name, ...exits[name] }));

export const withExits = (signature: GraphDef['signature'], exits: readonly Exit[]) => {
  const docs = exits.flatMap(({ name, label, description }): [string, ExitDoc][] =>
    label || description
      ? [[name, { ...(label ? { label } : {}), ...(description ? { description } : {}) }]]
      : []
  );
  const { exits: _, ...rest } = signature;
  return {
    ...rest,
    execOut: exits.map((e) => e.name),
    ...(docs.length ? { exits: Object.fromEntries(docs) } : {})
  };
};

const tidyName = (text: string) => text.trim().replace(/\s+/g, ' ');

export const nameExit = (def: GraphDef, index: number, text: string): GraphDef => {
  const exits = exitsOf(def.signature);
  const exit = exits[index];
  const label = tidyName(text);
  if (!exit || !label) return def;
  const others = [
    ...exits.filter((_, i) => i !== index).map((e) => e.name),
    ...def.signature.outputs.map((p) => p.name)
  ];
  const name = exitUsed(def, exit.name) ? exit.name : keyFromName(label, others);
  const { label: _, ...rest } = { ...exit, name };
  const next = pinLabel({ name }) === label ? rest : { ...rest, label };
  return {
    ...def,
    signature: withExits(
      def.signature,
      exits.map((e, i) => (i === index ? next : e))
    )
  };
};

const withoutReturnValues = (def: GraphDef, gone: ReadonlySet<string>): GraphDef => ({
  ...def,
  nodes: def.nodes.map((n) => {
    if (n.type !== RETURN_TYPE || !n.inputs) return n;
    const kept = Object.entries(n.inputs).filter(([k]) => !gone.has(k));
    return kept.length === Object.keys(n.inputs).length
      ? n
      : { ...n, inputs: Object.fromEntries(kept) };
  })
});

export const setPins = (
  def: GraphDef,
  catalog: Catalog,
  side: PinSide,
  pins: readonly PinSpec[]
) => {
  const kept = new Set(pins.map((p) => p.name));
  const gone = new Set(def.signature[side].map((p) => p.name).filter((n) => !kept.has(n)));
  const cleaned =
    side === 'inputs'
      ? removeNodes(
          def,
          def.nodes
            .filter((n) => n.type === INPUT_TYPE && gone.has(String(configOf(n).pin)))
            .map((n) => n.id)
        )
      : withoutReturnValues(def, gone);
  const next = { ...cleaned, signature: { ...cleaned.signature, [side]: [...pins] } };
  return dropUnfit(def, next, catalog);
};

export const removePin = (def: GraphDef, catalog: Catalog, side: PinSide, name: string) =>
  setPins(
    def,
    catalog,
    side,
    def.signature[side].filter((p) => p.name !== name)
  ).def;

export const setVariables = (def: GraphDef, catalog: Catalog, variables: GraphDef['variables']) => {
  const kept = new Set(variables.map((v) => v.name));
  const cleaned = removeNodes(
    def,
    def.nodes
      .filter((n) => VARIABLE_NODES.has(n.type) && !kept.has(String(configOf(n).name)))
      .map((n) => n.id)
  );
  return dropUnfit(def, { ...cleaned, variables: [...variables] }, catalog);
};

export const nameVariable = (def: GraphDef, index: number, text: string): GraphDef => {
  const variable = def.variables[index];
  const label = tidyName(text);
  if (!variable || !label) return def;
  const others = def.variables.filter((_, i) => i !== index).map((v) => v.name);
  const name = variableInExpressions(def, variable.name)
    ? variable.name
    : keyFromName(label, others);
  const renamed = renameVariable(def, variable.name, name);
  const { label: _, ...rest } = { ...variable, name };
  const next = pinLabel({ name }) === label ? rest : { ...rest, label };
  return { ...renamed, variables: renamed.variables.map((v, i) => (i === index ? next : v)) };
};

export const renamePinNamed = (
  def: GraphDef,
  side: PinSide,
  name: string,
  text: string,
  events: readonly EventDef[] = []
) => {
  const index = def.signature[side].findIndex((p) => p.name === name);
  return index < 0 ? def : namePin(def, side, index, text, events);
};
