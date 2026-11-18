import { createNodeCatalog, valueKinds, workflowEvents } from '@ugula/catalog';
import {
  combineSources,
  createRegistry,
  documentationIssues,
  isRecord,
  type NodeDef,
  type NodeInstance,
  refKey,
  SUBWORKFLOW_TRIGGER,
  stdGraphSource,
  TABLE_NODE_KINDS,
  tableFits,
  tableRefOf,
  tableSchemas,
  triggerOf,
  validateGraph
} from '@ugula/graph';
import * as v from 'valibot';
import type { SeedTable } from './builder.ts';
import type { SeedGraph } from './graphs.ts';

export const graphNodes = (): NodeDef[] => createNodeCatalog({ fetch });

const graphProblems = (graphs: SeedGraph[], nodes: NodeDef[]) => {
  const byRef = new Map(
    graphs.map((g) => [refKey({ type: g.key, version: g.version }), g.definition])
  );
  const registry = createRegistry(
    nodes,
    combineSources(stdGraphSource, (ref) => byRef.get(refKey(ref))),
    valueKinds,
    workflowEvents
  );
  const nodeTypes = new Set(nodes.map((n) => n.type));
  return graphs.flatMap((g) =>
    [
      ...(nodeTypes.has(g.key) ? [{ message: 'A node already has this key' }] : []),
      ...validateGraph(g.definition, registry),
      ...documentationIssues(g.definition),
      ...(g.kind !== 'workflow' && triggerOf(g.definition).kind !== 'manual'
        ? [{ message: SUBWORKFLOW_TRIGGER }]
        : [])
    ].map((i) => `${g.key}${'node' in i && i.node ? `#${i.node}` : ''}: ${i.message}`)
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
          tableFits(n, table.definition)
          ? []
          : [`${g.key}#${n.id}: table ${ref.key} is missing or has other fields`];
      })
    )
  ];
};

const isFormula = (n: NodeInstance) =>
  (isRecord(n.config) && 'expression' in n.config) ||
  Object.values(n.inputs ?? {}).some((b) => 'expr' in b);

const formulaProblems = (graphs: SeedGraph[]) =>
  graphs.flatMap((g) =>
    g.definition.nodes
      .filter(isFormula)
      .map((n) => `${g.key}#${n.id}: draw this with primitives instead of a formula`)
  );

export const seedProblems = (graphs: SeedGraph[], tables: SeedTable[], nodes: NodeDef[]) => [
  ...graphProblems(graphs, nodes),
  ...formulaProblems(graphs),
  ...tableProblems(tables, graphs)
];
