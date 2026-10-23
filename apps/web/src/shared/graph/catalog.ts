import { createBillingNodes } from '@ugula/billing';
import {
  combineSources,
  createRegistry,
  createStdNodes,
  type GraphDef,
  type NodeInstance,
  type NodeRef,
  RETURN_TYPE,
  refKey,
  type Signature,
  stdGraphSource,
  stdGraphs
} from '@ugula/graph';
import { createNemsisNodes } from '@ugula/nemsis';

export type PublishedNode = {
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
  graphOf: (ref: NodeRef) => GraphDef | undefined;
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
  const latest = [...new Map([...published].reverse().map((p) => [p.key, p])).values()];

  const palette: PaletteEntry[] = [
    {
      type: RETURN_TYPE,
      version: 1,
      title: 'Return',
      category: 'Graph',
      description: 'Completes this graph through an exec output.'
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
        title: titleFromKey(type),
        category: categoryOf(type),
        description: 'Standard composite node.'
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
      stubs.get(refKey(inst))?.name ??
      titleFromKey(inst.type),
    graphOf: (ref) => full.get(refKey(ref)) ?? stdGraphs[refKey(ref)]
  };
};
