import {
  combineSources,
  createRegistry,
  ENTRY_TYPE,
  type ExitDoc,
  type GraphDef,
  INPUT_TYPE,
  inputNode,
  type NodeDef,
  type NodeInstance,
  type NodeLevel,
  type NodeRef,
  RETURN_TYPE,
  refKey,
  type Signature,
  stdGraphInfo,
  stdGraphSource,
  stdGraphs,
  WORKFLOW_CALL_TYPES
} from '@ugula/graph';
import type * as v from 'valibot';
import { labelFromName } from '../format.ts';

export type PublishedNode = {
  graph_id: string;
  key: string;
  name: string;
  kind: 'workflow' | 'node';
  role: 'workflow' | 'stage' | 'rule' | 'slot';
  description: string;
  version: number;
  signature: Signature;
  overridden: boolean;
};

export type PaletteEntry = NodeRef & {
  title: string;
  category: string;
  description: string;
  level: NodeLevel;
  keywords: readonly string[];
};

type CatalogSources = {
  published?: readonly PublishedNode[];
  graphs?: readonly (NodeRef & { definition: GraphDef })[];
};

export type Catalog = {
  palette: PaletteEntry[];
  published: readonly PublishedNode[];
  signatureOf: (inst: NodeInstance, owner: GraphDef) => Signature | null;
  titleOf: (inst: NodeInstance) => string;
  describe: (inst: NodeInstance) => string;
  hasConfig: (inst: NodeInstance) => boolean;
  configSchemaOf: (inst: NodeInstance) => v.GenericSchema | undefined;
  summaryOf: (inst: NodeInstance) => string | null;
  exitsOf: (inst: NodeInstance, owner: GraphDef) => Readonly<Record<string, ExitDoc>>;
  graphOf: (ref: NodeRef) => GraphDef | undefined;
  opensAs: (inst: NodeInstance) => 'graph' | 'workflow' | null;
  publishedOf: (inst: NodeInstance) => PublishedNode | undefined;
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

export const createCatalog = (
  nodes: NodeDef[],
  { published = [], graphs = [] }: CatalogSources = {}
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
    signatureOf: (inst, owner) => {
      try {
        return registry.signature(inst, owner);
      } catch {
        return null;
      }
    },
    titleOf: (inst) =>
      inst.label ??
      (inst.type === INPUT_TYPE ? inputTitle(inst) : undefined) ??
      registry.node(inst)?.title ??
      stdGraphInfo[refKey(inst)]?.title ??
      stubs.get(refKey(inst))?.name ??
      (inst.type === ENTRY_TYPE
        ? 'Start'
        : inst.type === RETURN_TYPE
          ? 'Return'
          : titleFromKey(inst.type)),
    describe: (inst) =>
      inst.type === ENTRY_TYPE
        ? ENTRY_DESCRIPTION
        : inst.type === RETURN_TYPE
          ? RETURN_DESCRIPTION
          : (registry.node(inst)?.description ??
            stdGraphInfo[refKey(inst)]?.description ??
            stubs.get(refKey(inst))?.description ??
            ''),
    hasConfig: (inst) => registry.node(inst)?.config !== undefined,
    configSchemaOf: (inst) => registry.node(inst)?.config,
    summaryOf: (inst) => {
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
    opensAs: (inst) => {
      if (workflowRefOf(inst)) return 'workflow';
      const composite = graphOf(inst) !== undefined || stubs.has(refKey(inst));
      return composite && !inst.type.startsWith('std.graph.') ? 'graph' : null;
    },
    publishedOf: (inst) => stubs.get(refKey(workflowRefOf(inst) ?? inst))
  };
};
