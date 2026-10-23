import { createBillingNodes } from '@ugula/billing';
import {
  combineSources,
  createRegistry,
  createStdNodes,
  ENTRY_TYPE,
  type GraphDef,
  type NodeInstance,
  type NodeRef,
  RETURN_TYPE,
  refKey,
  type Signature,
  stdGraphInfo,
  stdGraphSource,
  stdGraphs
} from '@ugula/graph';
import { createNemsisNodes } from '@ugula/nemsis';

export type PublishedNode = {
  graph_id: string;
  key: string;
  name: string;
  kind: 'workflow' | 'node';
  description: string;
  version: number;
  signature: Signature;
};

export type PaletteEntry = NodeRef & {
  title: string;
  category: string;
  description: string;
};

export type CatalogSources = {
  published?: readonly PublishedNode[];
  graphs?: readonly (NodeRef & { definition: GraphDef })[];
};

export type Catalog = {
  palette: PaletteEntry[];
  signatureOf: (inst: NodeInstance, owner: GraphDef) => Signature | null;
  titleOf: (inst: NodeInstance) => string;
  /** What the node does, in a sentence or two. */
  describe: (inst: NodeInstance) => string;
  /** Whether the node takes settings beyond its inputs. */
  hasConfig: (inst: NodeInstance) => boolean;
  graphOf: (ref: NodeRef) => GraphDef | undefined;
  /** What double-clicking the node opens: its own sub-graph, or the workflow it starts as runs. */
  opensAs: (inst: NodeInstance) => 'graph' | 'workflow' | null;
  /** The published workflow a node refers to, for linking to its editor. */
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

const stdNodes = [
  ...createStdNodes({ fetch: (...args) => fetch(...args) }),
  ...createNemsisNodes(null),
  ...createBillingNodes(null)
];

export const titleFromKey = (key: string) =>
  (key.split('.').at(-1) ?? key)
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const categoryOf = (type: string) => {
  const prefix = type.split('.').slice(0, 2).join('.');
  return stdNodes.find((d) => d.type.startsWith(`${prefix}.`))?.category ?? 'Composites';
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

export const createCatalog = ({ published = [], graphs = [] }: CatalogSources = {}): Catalog => {
  const full = new Map(graphs.map((g) => [refKey(g), g.definition]));
  const stubs = new Map(published.map((p) => [refKey({ type: p.key, version: p.version }), p]));
  const registry = createRegistry(
    stdNodes,
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
      type: RETURN_TYPE,
      version: 1,
      title: 'Return',
      category: 'Graph',
      description: RETURN_DESCRIPTION
    },
    ...stdNodes.map((d) => ({
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
        category: categoryOf(type),
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
