import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { PublishedGraph } from '@ugula/db';
import { actionNode, createStdNodes, ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { buildEngine, bundleKey, createEngineCache } from './engines.ts';

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

  it('retries transient node failures on a timer instead of faulting', async () => {
    const down = actionNode({
      type: 'demo.down',
      title: 'Down',
      category: 'Demo',
      description: 'Cannot reach its service.',
      inputs: [],
      outputs: [],
      compute: () => {
        throw new TypeError('fetch failed');
      }
    });
    const flaky: GraphDef = {
      ...def,
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        { id: 'call', type: 'demo.down', version: 1 }
      ],
      edges: [{ from: 'entry', fromPin: 'exec', to: 'call', toPin: 'exec' }]
    };
    const { engine, root } = buildEngine(
      [...nodes, down],
      [{ id: 'v', key: 'demo.flaky', version: 1, definition: flaky }],
      'v'
    );
    const state = engine.start(root, {}, { now: new Date(0) });
    await engine.drain(state, { runId: 'r', now: new Date(0) });
    assert.equal(state.status, 'suspended');
    assert.equal(state.suspension?.kind, 'timer');
  });

  it('rejects missing roots and malformed definitions', () => {
    assert.throws(() => buildEngine(nodes, rows, 'nope'), /not found/);
    assert.throws(() =>
      buildEngine(nodes, [{ id: 'v', key: 'a.b', version: 1, definition: { nodes: 1 } }], 'v')
    );
  });
});

const tableFlow: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [],
    outputs: [{ name: 'code', type: 'string' }]
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    {
      id: 'codes',
      type: 'std.table.lookup',
      version: 1,
      config: { type: 'string', table: { key: 'demo.codes' } },
      inputs: { key: { value: 'a' } }
    },
    { id: 'return', type: 'std.graph.return', version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'return', toPin: 'exec' },
    { from: 'codes', fromPin: 'value', to: 'return', toPin: 'code' }
  ]
};

describe('pinned tables', () => {
  it('runs table nodes on the table versions the run pinned', async () => {
    const loaded: string[][] = [];
    const engines = createEngineCache({
      nodes,
      loadDefinitions: async () => [{ id: 'v-t', definition: tableFlow }],
      loadTables: async (ids) => {
        loaded.push(ids);
        return [{ id: 'tv-1', kind: 'lookup', definition: { rows: [{ key: 'a', value: 'A1' }] } }];
      }
    });
    const graphs = [{ id: 'v-t', key: 'demo.tables', version: 1 }];
    const { engine, root } = await engines({
      versionId: 'v-t',
      graphs,
      tables: [{ id: 'tv-1', key: 'demo.codes' }]
    });
    const state = engine.start(root, {}, { now: new Date(0) });
    await engine.drain(state, { runId: 'r', now: new Date(0) });
    assert.deepEqual(state.result?.outputs, { code: 'A1' });
    assert.deepEqual(loaded, [['tv-1']]);

    const missing = await engines({ versionId: 'v-t', graphs, tables: [] });
    const faulted = missing.engine.start(missing.root, {}, { now: new Date(0) });
    await missing.engine.drain(faulted, { runId: 'r', now: new Date(0) });
    assert.equal(faulted.status, 'faulted');
    assert.match(faulted.fault?.error.message ?? '', /demo.codes is not available/);
    assert.equal(loaded.length, 1);
  });
});

describe('createEngineCache', () => {
  it('reuses engines per pinned bundle, evicts least recently used, and forgets failures', async () => {
    const loads: string[][] = [];
    const bundles: Record<string, PublishedGraph[]> = {
      a: rows,
      b: rows.map((r) => (r.id === 'v-child' ? { ...r, id: 'v-override' } : r)),
      bad: rows.map((r) => (r.id === 'v-child' ? { ...r, id: 'v-bad' } : r))
    };
    const engines = createEngineCache({
      nodes,
      max: 1,
      loadTables: async () => [],
      loadDefinitions: async (ids) => {
        loads.push(ids);
        if (ids.includes('v-root') && loads.length > 3) throw new Error('db down');
        return rows.flatMap((r) =>
          ids.includes(r.id)
            ? [r]
            : r.id === 'v-child' && ids.includes('v-override')
              ? [{ ...r, id: 'v-override' }]
              : []
        );
      }
    });
    const run = (id: string) =>
      engines({
        versionId: 'v-root',
        graphs: (bundles[id] ?? []).map(({ definition: _, ...ref }) => ref),
        tables: []
      });
    await run('a');
    await run('a');
    await run('b');
    await run('a');
    assert.equal(loads.length, 3);
    await assert.rejects(() => run('bad'), /db down/);
    assert.equal(loads.length, 4);
    assert.equal(bundleKey('v', [{ id: 'x', key: 'k.a', version: 2 }]), 'v|k.a@2=x');
    assert.equal(bundleKey('v', [], [{ id: 't2', key: 'k.t' }]), 'v|#k.t=t2');
  });
});
