import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createStdNodes, ENTRY_TYPE, type GraphDef, RETURN_TYPE } from '@ugula/graph';
import { callerOf, createEvaluate, evaluateBundle } from './evaluate.ts';

const nodes = createStdNodes({ fetch });

const double: GraphDef = {
  signature: {
    execIn: [],
    execOut: [],
    inputs: [{ name: 'x', type: 'number' }],
    outputs: [{ name: 'y', type: 'number' }]
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'times', type: 'std.math.multiply', version: 1, inputs: { b: { value: 2 } } },
    { id: 'return', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'x', to: 'times', toPin: 'a' },
    { from: 'times', fromPin: 'result', to: 'return', toPin: 'y' }
  ]
};

const graph = { key: 'acme.double', version: 1 };

const rows = [{ id: 'v1', key: 'acme.double', version: 1, definition: double }];

describe('evaluate', () => {
  it('calls a pure graph with its own inputs and returns one output', () => {
    const caller = callerOf(graph, double, 'y');
    assert.deepEqual(caller.signature.inputs, double.signature.inputs);
    assert.equal(caller.edges.length, 3);
  });

  it('runs a published graph once per input set', async () => {
    assert.deepEqual(
      await evaluateBundle(nodes, rows, graph, [{ x: 2 }, { x: 5 }], 'y', new Date(0)),
      [4, 10]
    );
    await assert.rejects(
      () => evaluateBundle(nodes, rows, { ...graph, version: 2 }, [], 'y', new Date(0)),
      /not published/
    );
    await assert.rejects(
      () => evaluateBundle(nodes, rows, graph, [{ x: 'two' }], 'y', new Date(0)),
      /expected number/
    );
  });

  it('resolves the tenant bundle, using the requested version for an override', async () => {
    const { db } = createRecordingDb((q) => {
      if (q.sql.includes('cross join lateral') && !q.sql.includes('recursive')) {
        return [{ id: 'v9', key: 'acme.double', version: 1, definition: double }];
      }
      if (q.sql.includes('with recursive')) return [{ id: 'v9', key: 'acme.double', version: 3 }];
      if (q.sql.includes('from "graph_versions"')) return [{ id: 'v9', definition: double }];
      return [];
    });
    const evaluate = createEvaluate(nodes, () => new Date(0));
    assert.deepEqual(await evaluate(db, 't1', graph, [{ x: 4 }], 'y'), [8]);
    const missing = createRecordingDb(() => []);
    await assert.rejects(() => evaluate(missing.db, 't1', graph, [], 'y'), /not published/);
  });
});
