import {
  type Adoption,
  combineSources,
  createRegistry,
  ENTRY_TYPE,
  type EventDef,
  type ExitDoc,
  entryTrigger,
  type GraphDef,
  INPUT_TYPE,
  inputNode,
  isPure,
  type Json,
  type NodeDef,
  type NodeInstance,
  type NodeLevel,
  type NodeRef,
  type PinSpec,
  RETURN_TYPE,
  refKey,
  ruleRefOf,
  type Signature,
  stdGraphInfo,
  stdGraphSource,
  stdGraphs,
  triggerSummary,
  WORKFLOW_CALL_TYPES
} from '@ugula/graph';
import type * as v from 'valibot';
import { labelFromName } from '../format.ts';
import { fieldNodeInfo, type Models, SET_FIELD } from './record-fields.ts';

export type PublishedNode = {
  graph_id: string;
  key: string;
  name: string;
  kind: 'workflow' | 'node';
  role: 'workflow' | 'stage' | 'rule';
  description: string;
  version: number;
  signature: Signature;
  overridden: boolean;
};

export type Opens = 'graph' | 'workflow' | 'rule';

export const OPENS_LABELS: Readonly<Record<Opens, string>> = {
  graph: 'Subworkflow',
  workflow: 'Workflow',
  rule: 'Rule'
};

export type NodeKind = 'entry' | 'action' | 'pure' | 'flow' | 'human' | 'table' | 'call';

export type PaletteEntry = NodeRef & {
  title: string;
  category: string;
  description: string;
  level: NodeLevel;
  keywords: readonly string[];
  config?: Json;
};

type CatalogSources = {
  published?: readonly PublishedNode[];
  graphs?: readonly (NodeRef & { definition: GraphDef })[];
  events?: readonly EventDef[];
  models?: Models;
};

export const eventLabel = (events: readonly EventDef[], type: string) =>
  events.find((e) => e.type === type)?.label ?? type;

const entryTitle = (inst: NodeInstance, events: readonly EventDef[]) => {
  const trigger = entryTrigger(inst.config);
  return trigger.kind === 'event'
    ? `On ${eventLabel(events, trigger.event)}`
    : trigger.kind === 'schedule'
      ? 'On Schedule'
      : 'Start';
};

const entrySummary = (inst: NodeInstance, events: readonly EventDef[]) =>
  triggerSummary(entryTrigger(inst.config), (type) => eventLabel(events, type));

export type Catalog = {
  palette: PaletteEntry[];
  published: readonly PublishedNode[];
  models: Models;
  signatureOf: (inst: NodeInstance, owner: GraphDef) => Signature | null;
  titleOf: (inst: NodeInstance) => string;
  describe: (inst: NodeInstance) => string;
  hasConfig: (inst: NodeInstance) => boolean;
  configSchemaOf: (inst: NodeInstance) => v.GenericSchema | undefined;
  summaryOf: (inst: NodeInstance) => string | null;
  exitsOf: (inst: NodeInstance, owner: GraphDef) => Readonly<Record<string, ExitDoc>>;
  graphOf: (ref: NodeRef) => GraphDef | undefined;
  opensAs: (inst: NodeInstance) => Opens | null;
  publishedOf: (inst: NodeInstance) => PublishedNode | undefined;
  kindOf: (inst: NodeInstance, signature: Signature | null) => NodeKind;
  adoptionsOf: (inst: NodeInstance) => readonly Adoption[];
};

const workflowRefOf = (inst: NodeInstance): NodeRef | null => {
  const config = inst.config;
  if (!WORKFLOW_CALL_TYPES.has(inst.type) || typeof config !== 'object' || config === null)
    return null;
  const { workflow, version } = config as { workflow?: unknown; version?: unknown };
  return typeof workflow === 'string' && typeof version === 'number'
    ? { type: workflow, version }
    : null;
};

const inputTitle = (inst: NodeInstance) => {
  const pin = (inst.config as { pin?: unknown } | undefined)?.pin;
  return typeof pin === 'string' && pin ? `Get ${labelFromName(pin)}` : undefined;
};

export const titleFromKey = (key: string) => labelFromName(key.split('.').at(-1) ?? key);

const categoryOf = (nodes: readonly NodeDef[], type: string) => {
  const prefix = type.split('.').slice(0, 2).join('.');
  return nodes.find((d) => d.type.startsWith(`${prefix}.`))?.category ?? 'Composites';
};

const CATEGORY_KINDS: Readonly<Record<string, NodeKind>> = {
  Flow: 'flow',
  Human: 'human',
  Tables: 'table'
};

const ENTRY_DESCRIPTION =
  'Where this graph starts. Its inputs are available from here to every node that needs them.';

const RETURN_DESCRIPTION =
  'Finishes this graph and hands the values wired into it back as outputs.';

const stub = (signature: Signature): GraphDef => ({
  signature,
  variables: [],
  nodes: [],
  edges: []
});

const fieldTitle = (inst: NodeInstance, models: Models) => {
  const field = fieldNodeInfo(inst, models);
  if (!field) return undefined;
  return inst.type === SET_FIELD.type ? `Set ${field.label}` : field.label;
};

export const createCatalog = (
  nodes: NodeDef[],
  { published = [], graphs = [], events = [], models = {} }: CatalogSources = {}
): Catalog => {
  const full = new Map(graphs.map((g) => [refKey(g), g.definition]));
  const stubs = new Map(published.map((p) => [refKey({ type: p.key, version: p.version }), p]));
  const registry = createRegistry(
    nodes,
    combineSources(
      stdGraphSource,
      (ref) => full.get(refKey(ref)),
      (ref) => {
        const p = stubs.get(refKey(ref));
        return p ? stub(p.signature) : undefined;
      }
    )
  );
  const graphOf = (ref: NodeRef) => full.get(refKey(ref)) ?? stdGraphs[refKey(ref)];
  const opensAs = (inst: NodeInstance) => {
    if (workflowRefOf(inst)) return 'workflow' as const;
    if (ruleRefOf(inst)) return 'rule' as const;
    const composite = graphOf(inst) !== undefined || stubs.has(refKey(inst));
    return composite && !inst.type.startsWith('std.graph.') ? ('graph' as const) : null;
  };
  const publishedOf = (inst: NodeInstance) =>
    stubs.get(refKey(workflowRefOf(inst) ?? ruleRefOf(inst) ?? inst));
  const latest = [...new Map([...published].reverse().map((p) => [p.key, p])).values()];

  const entryOf = (d: NodeDef): PaletteEntry => ({
    type: d.type,
    version: d.version,
    title: d.title,
    category: d.category,
    description: d.description,
    level: d.level ?? 'basic',
    keywords: d.keywords ?? []
  });

  const graphEntry = (
    type: string,
    version: number,
    title: string,
    category: string,
    description: string
  ): PaletteEntry => ({
    type,
    version,
    title,
    category,
    description,
    level: 'basic',
    keywords: []
  });

  const palette = [
    entryOf(inputNode),
    graphEntry(RETURN_TYPE, 1, 'Return', 'Graph', RETURN_DESCRIPTION),
    ...nodes.map(entryOf),
    ...Object.keys(stdGraphs).map((key) => {
      const [type = key, version = '1'] = key.split('@');
      return graphEntry(
        type,
        Number(version),
        stdGraphInfo[key]?.title ?? titleFromKey(type),
        categoryOf(nodes, type),
        stdGraphInfo[key]?.description ?? ''
      );
    }),
    ...latest.map((p) =>
      graphEntry(
        p.key,
        p.version,
        p.name,
        p.kind === 'node' ? 'Custom Nodes' : 'Workflows',
        p.description
      )
    )
  ].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

  return {
    palette,
    published,
    models,
    signatureOf: (inst, owner) => {
      try {
        const sig = registry.signature(inst, owner);
        const field = fieldNodeInfo(inst, models);
        if (!field) return sig;
        const relabel = (p: PinSpec) =>
          p.name === 'value'
            ? {
                ...p,
                label: field.label,
                ...(field.description ? { description: field.description } : {})
              }
            : p;
        return { ...sig, inputs: sig.inputs.map(relabel), outputs: sig.outputs.map(relabel) };
      } catch {
        return null;
      }
    },
    titleOf: (inst) =>
      inst.label ??
      fieldTitle(inst, models) ??
      (inst.type === ENTRY_TYPE ? entryTitle(inst, events) : undefined) ??
      (inst.type === INPUT_TYPE ? inputTitle(inst) : undefined) ??
      registry.node(inst)?.title ??
      stdGraphInfo[refKey(inst)]?.title ??
      stubs.get(refKey(inst))?.name ??
      (inst.type === RETURN_TYPE ? 'Return' : titleFromKey(inst.type)),
    describe: (inst) =>
      fieldNodeInfo(inst, models)?.description ||
      (inst.type === ENTRY_TYPE
        ? ENTRY_DESCRIPTION
        : inst.type === RETURN_TYPE
          ? RETURN_DESCRIPTION
          : (registry.node(inst)?.description ??
            stdGraphInfo[refKey(inst)]?.description ??
            stubs.get(refKey(inst))?.description ??
            '')),
    hasConfig: (inst) => registry.node(inst)?.config !== undefined,
    configSchemaOf: (inst) => registry.node(inst)?.config,
    summaryOf: (inst) => {
      if (inst.type === ENTRY_TYPE) return entrySummary(inst, events);
      const field = fieldNodeInfo(inst, models);
      if (field)
        return field.from ? `${inst.type === SET_FIELD.type ? 'On' : 'From'} ${field.from}` : null;
      try {
        return registry.node(inst)?.summary?.(registry.config(inst)) ?? null;
      } catch {
        return null;
      }
    },
    exitsOf: (inst, owner) => {
      try {
        return { ...registry.signature(inst, owner).exits, ...registry.node(inst)?.exits };
      } catch {
        return registry.node(inst)?.exits ?? {};
      }
    },
    graphOf,
    opensAs,
    publishedOf,
    adoptionsOf: (inst) => registry.node(inst)?.adopts ?? [],
    kindOf: (inst, signature) => {
      if (inst.type === ENTRY_TYPE || inst.type === RETURN_TYPE) return 'entry';
      if (opensAs(inst)) return 'call';
      const kind = CATEGORY_KINDS[registry.node(inst)?.category ?? ''];
      if (kind) return kind;
      return signature && isPure(signature) ? 'pure' : 'action';
    }
  };
};
