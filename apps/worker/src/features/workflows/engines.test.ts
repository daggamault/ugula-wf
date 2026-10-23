import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PublishedGraph } from '@ugula/db';
import { createStdNodes, ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { buildEngine, createEngineCache } from './engines.ts';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'child', type: 'demo.child', version: 3 }
  ],
  edges: [{ from: 'entry', fromPin: 'exec', to: 'child', toPin: 'exec' }]
};

const child: GraphDef = {
  ...def,
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const rows: PublishedGraph[] = [
  { id: 'v-root', key: 'demo.root', version: 1, definition: def },
  { id: 'v-child', key: 'demo.child', version: 3, definition: child }
];

const nodes = createStdNodes({ fetch });

describe('buildEngine', () => {
  it('resolves composites from the bundle and std graphs, rooted at the requested version', async () => {
    const { engine, root } = buildEngine(nodes, rows, 'v-root');
    assert.deepEqual(root, { type: 'demo.root', version: 1 });
    assert.ok(engine.registry.graph({ type: 'demo.child', version: 3 }));
    assert.ok(engine.registry.graph({ type: 'std.math.clamp', version: 1 }));
    const state = engine.start(root, {}, { now: new Date(0) });
    await engine.drain(state, { runId: 'r', now: new Date(0) });
    assert.equal(state.status, 'completed');
  });

  it('rejects missing roots and malformed definitions', () => {
    assert.throws(() => buildEngine(nodes, rows, 'nope'), /not found/);
    assert.throws(() =>
      buildEngine(nodes, [{ id: 'v', key: 'a.b', version: 1, definition: { nodes: 1 } }], 'v')
    );
  });
});

describe('createEngineCache', () => {
  it('loads each version once, evicts least recently used, and forgets failures', async () => {
    const loads: string[] = [];
    const engines = createEngineCache({
      nodes,
      max: 1,
      loadBundle: async (id) => {
        loads.push(id);
        if (id === 'bad') throw new Error('db down');
        return rows.map((r) => (r.id === 'v-root' ? { ...r, id } : r));
      }
    });
    await engines('a');
    await engines('a');
    await engines('b');
    await engines('a');
    await assert.rejects(() => engines('bad'), /db down/);
    await assert.rejects(() => engines('bad'), /db down/);
    assert.deepEqual(loads, ['a', 'b', 'a', 'bad', 'bad']);
  });
});
