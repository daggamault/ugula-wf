import { type Db, findPublishedGraphs, type PublishedGraph, resolveBundle } from '@ugula/db';
import {
  combineSources,
  createEngine,
  ENTRY_TYPE,
  type GraphDef,
  graphDefSchema,
  type Json,
  type NodeDef,
  RETURN_TYPE,
  refKey,
  stdGraphSource
} from '@ugula/graph';
import * as v from 'valibot';

export type GraphKey = { key: string; version: number };

export type Evaluate = (
  db: Db,
  tenantId: string,
  graph: GraphKey,
  inputs: Record<string, Json>[],
  output: string
) => Promise<Json[]>;

const MAIN = { type: 'api.evaluate', version: 1 };

export const callerOf = (graph: GraphKey, def: GraphDef, output: string): GraphDef => ({
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: def.signature.inputs,
    outputs: [{ name: output, type: 'any', optional: true }]
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'graph', type: graph.key, version: graph.version },
    { id: 'return', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'return', toPin: 'exec' },
    ...def.signature.inputs.map((p) => ({
      from: 'entry',
      fromPin: p.name,
      to: 'graph',
      toPin: p.name
    })),
    { from: 'graph', fromPin: output, to: 'return', toPin: output }
  ]
});

export const evaluateBundle = async (
  nodes: NodeDef[],
  rows: PublishedGraph[],
  graph: GraphKey,
  inputs: Record<string, Json>[],
  output: string,
  now: Date
) => {
  const graphs = new Map(
    rows.map((r) => [
      refKey({ type: r.key, version: r.version }),
      v.parse(graphDefSchema, r.definition)
    ])
  );
  const def = graphs.get(refKey({ type: graph.key, version: graph.version }));
  if (!def) throw new Error(`${graph.key}@${graph.version} is not published`);
  const caller = callerOf(graph, def, output);
  const engine = createEngine({
    nodes,
    graphs: combineSources(stdGraphSource, (ref) =>
      refKey(ref) === refKey(MAIN) ? caller : graphs.get(refKey(ref))
    )
  });
  const results: Json[] = [];
  for (const values of inputs) {
    const state = engine.start(MAIN, values, { now });
    await engine.drain(state, { runId: 'evaluate', now });
    if (state.status !== 'completed') {
      throw new Error(state.fault?.error.message ?? `${graph.key} did not finish`);
    }
    results.push(state.result?.outputs[output] ?? null);
  }
  return results;
};

export const createEvaluate =
  (nodes: NodeDef[], now: () => Date): Evaluate =>
  async (db, tenantId, graph, inputs, output) => {
    const [root] = await findPublishedGraphs(db, tenantId, [graph]);
    if (!root) throw new Error(`${graph.key}@${graph.version} is not published`);
    const rows = await resolveBundle(db, tenantId, root.id);
    return evaluateBundle(
      nodes,
      rows.map((r) => (r.id === root.id ? { ...r, key: graph.key, version: graph.version } : r)),
      graph,
      inputs,
      output,
      now()
    );
  };
