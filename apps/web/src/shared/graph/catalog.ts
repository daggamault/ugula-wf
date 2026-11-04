import {
  combineSources,
  createRegistry,
  ENTRY_TYPE,
  type GraphDef,
  INPUT_TYPE,
  inputNode,
  type NodeDef,
  type NodeInstance,
  type NodeRef,
  RETURN_TYPE,
  refKey,
  type Signature,
  stdGraphInfo,
  stdGraphSource,
  stdGraphs
} from '@ugula/graph';
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
};

type CatalogSources = {
  published?: readonly PublishedNode[];
  graphs?: readonly (NodeRef & { definition: GraphDef })[];
};

export type Catalog = {
  palette: PaletteEntry[];
  signatureOf: (inst: NodeInstance, owner: GraphDef) => Signature | null;
  titleOf: (inst: NodeInstance) => string;
  describe: (inst: NodeInstance) => string;
  hasConfig: (inst: NodeInstance) => boolean;
  graphOf: (ref: NodeRef) => GraphDef | undefined;
  opensAs: (inst: NodeInstance) => 'graph' | 'workflow' | null;
  publishedOf: (inst: NodeInstance) => PublishedNode | undefined;
};

const SPAWNING = new Set([
  'std.flow.run-workflow',
  'std.flow.start-workflow',
  'std.flow.map-workflow'
]);

const workflowRefOf = (inst: NodeInstance): NodeRef | null => {
  const config = inst.config;
  if (!SPAWNING.has(inst.type) || typeof config !== 'object' || config === null) return null;
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

  const palette: PaletteEntry[] = [
    {
      type: inputNode.type,
      version: inputNode.version,
      title: inputNode.title,
      category: inputNode.category,
      description: inputNode.description
    },
    {
      type: RETURN_TYPE,
      version: 1,
      title: 'Return',
      category: 'Graph',
      description: RETURN_DESCRIPTION
    },
    ...nodes.map((d) => ({
      type: d.type,
      version: d.version,
      title: d.title,
      category: d.category,
      description: d.description
    })),
    ...Object.keys(stdGraphs).map((key) => {
      const [type = key, version = '1'] = key.split('@');
      return {
        type,
        version: Number(version),
        title: stdGraphInfo[key]?.title ?? titleFromKey(type),
        category: categoryOf(nodes, type),
        description: stdGraphInfo[key]?.description ?? ''
      };
    }),
    ...latest.map((p) => ({
      type: p.key,
      version: p.version,
      title: p.name,
      category: p.kind === 'node' ? 'Custom Nodes' : 'Workflows',
      description: p.description
    }))
  ].sort((a, b) => a.category.localeCompare(b.category) || a.title.localeCompare(b.title));

  return {
    palette,
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
    graphOf,
    opensAs: (inst) => {
      if (workflowRefOf(inst)) return 'workflow';
      const composite = graphOf(inst) !== undefined || stubs.has(refKey(inst));
      return composite && !inst.type.startsWith('std.graph.') ? 'graph' : null;
    },
    publishedOf: (inst) => stubs.get(refKey(workflowRefOf(inst) ?? inst))
  };
};
