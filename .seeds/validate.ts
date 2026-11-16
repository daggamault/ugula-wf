import { PERMISSIONS } from '@ugula/access';
import { billingKinds, billingModels, createBillingNodes } from '@ugula/billing';
import {
  combineSources,
  createModelNodes,
  createRegistry,
  createStdNodes,
  documentationIssues,
  mergeKinds,
  type NodeDef,
  refKey,
  STD_KINDS,
  stdGraphSource,
  TABLE_NODE_KINDS,
  tableContract,
  tableRefOf,
  tableSchemas,
  validateGraph
} from '@ugula/graph';
import { createNemsisNodes, nemsisKinds, nemsisModels } from '@ugula/nemsis';
import * as v from 'valibot';
import type { SeedTable } from './builder.ts';
import type { SeedGraph } from './graphs.ts';

export const graphNodes = (): NodeDef[] => [
  ...createStdNodes({ fetch, permissions: PERMISSIONS }),
  ...createNemsisNodes(null),
  ...createBillingNodes(null),
  ...createModelNodes([...nemsisModels, ...billingModels])
];

export const graphProblems = (graphs: SeedGraph[], nodes: NodeDef[]) => {
  const byRef = new Map(
    graphs.map((g) => [refKey({ type: g.key, version: g.version }), g.definition])
  );
  const registry = createRegistry(
    nodes,
    combineSources(stdGraphSource, (ref) => byRef.get(refKey(ref))),
    mergeKinds(STD_KINDS, nemsisKinds, billingKinds)
  );
  return graphs.flatMap((g) =>
    [...validateGraph(g.definition, registry), ...documentationIssues(g.definition)].map(
      (i) => `${g.key}${i.node ? `#${i.node}` : ''}: ${i.message}`
    )
  );
};

const tableProblems = (tables: SeedTable[], graphs: SeedGraph[]) => {
  const byKey = new Map(tables.map((t) => [t.key, t]));
  return [
    ...tables.flatMap((t) =>
      v.safeParse(tableSchemas[t.kind], t.definition).success ? [] : [`${t.key}: invalid table`]
    ),
    ...graphs.flatMap((g) =>
      g.definition.nodes.flatMap((n) => {
        const ref = tableRefOf(n);
        const table = ref && byKey.get(ref.key);
        if (!ref) return [];
        return table &&
          TABLE_NODE_KINDS[n.type as keyof typeof TABLE_NODE_KINDS] === table.kind &&
          tableContract(table.definition) === tableContract(n.config ?? null)
          ? []
          : [`${g.key}#${n.id}: table ${ref.key} is missing or has other fields`];
      })
    )
  ];
};

export const seedProblems = (graphs: SeedGraph[], tables: SeedTable[], nodes: NodeDef[]) => [
  ...graphProblems(graphs, nodes),
  ...tableProblems(tables, graphs)
];
