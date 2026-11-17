import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { GraphRef, PublishedGraph } from '@ugula/db';
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

const refs: GraphRef[] = rows.map(({ definition: _, ...ref }) => ref);

const nodes = createStdNodes({ fetch });

describe('bundleKey', () => {
  it('keys a bundle by its root and its sorted graph and table pins', () => {
    assert.equal(bundleKey('v', [{ id: 'x', key: 'k.a', version: 2 }]), 'v|k.a@2=x');
    assert.equal(bundleKey('v', [], [{ id: 't2', key: 'k.t' }]), 'v|#k.t=t2');
    assert.equal(
      bundleKey(
        'v',
        [
          { id: 'y', key: 'k.b', version: 1 },
          { id: 'x', key: 'k.a', version: 2 }
        ],
        [
          { id: 't2', key: 'k.u' },
          { id: 't1', key: 'k.t' }
        ]
      ),
      'v|k.a@2=x|k.b@1=y|#k.t=t1|#k.u=t2'
    );
  });
});

describe('buildEngine', () => {
  it('resolves composites from the bundle and std graphs, rooted at the requested version', async () => {
    const { engine, root } = buildEngine(nodes, rows, 'v-root');
    assert.deepEqual(root, { type: 'demo.root', version: 1 });
    assert.deepEqual(engine.registry.graph({ type: 'demo.child', version: 3 })?.def, child);
    assert.ok(engine.registry.graph({ type: 'std.math.clamp', version: 1 }));
    assert.equal(engine.registry.graph({ type: 'demo.child', version: 4 }), undefined);
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

  it('rejects a root missing from the bundle', () => {
    assert.throws(() => buildEngine(nodes, rows, 'nope'), /^Error: Graph version nope not found$/);
  });

  it('rejects a malformed definition', () => {
    assert.throws(
      () =>
        buildEngine(nodes, [{ id: 'v', key: 'a.b', version: 1, definition: { nodes: 1 } }], 'v'),
      { name: 'ValiError' }
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

const tableGraphs = [{ id: 'v-t', key: 'demo.tables', version: 1 }];

const codesTable = {
  id: 'tv-1',
  kind: 'lookup' as const,
  definition: { rows: [{ key: 'a', value: 'A1' }] }
};

const runOnce = async ({
  engine,
  root
}: Awaited<ReturnType<ReturnType<typeof createEngineCache>>>) => {
  const state = engine.start(root, {}, { now: new Date(0) });
  await engine.drain(state, { runId: 'r', now: new Date(0) });
  return state;
};

describe('pinned tables', () => {
  it('runs table nodes on the table versions the run pinned', async () => {
    const loaded: string[][] = [];
    const engines = createEngineCache({
      nodes,
      loadDefinitions: async () => [{ id: 'v-t', definition: tableFlow }],
      loadTables: async (ids) => {
        loaded.push(ids);
        return [codesTable];
      }
    });
    const state = await runOnce(
      await engines({
        versionId: 'v-t',
        graphs: tableGraphs,
        tables: [{ id: 'tv-1', key: 'demo.codes' }]
      })
    );
    assert.deepEqual(state.result?.outputs, { code: 'A1' });
    assert.deepEqual(loaded, [['tv-1']]);
  });

  it('loads no tables for a run that pinned none, leaving table nodes to fault', async () => {
    const loaded: string[][] = [];
    const engines = createEngineCache({
      nodes,
      loadDefinitions: async () => [{ id: 'v-t', definition: tableFlow }],
      loadTables: async (ids) => {
        loaded.push(ids);
        return [codesTable];
      }
    });
    const state = await runOnce(
      await engines({ versionId: 'v-t', graphs: tableGraphs, tables: [] })
    );
    assert.equal(state.status, 'faulted');
    assert.match(state.fault?.error.message ?? '', /demo\.codes is not available/);
    assert.deepEqual(loaded, []);
  });

  it('leaves out a pinned table whose version could not be loaded', async () => {
    const engines = createEngineCache({
      nodes,
      loadDefinitions: async () => [{ id: 'v-t', definition: tableFlow }],
      loadTables: async () => []
    });
    const state = await runOnce(
      await engines({
        versionId: 'v-t',
        graphs: tableGraphs,
        tables: [{ id: 'tv-9', key: 'demo.codes' }]
      })
    );
    assert.equal(state.status, 'faulted');
    assert.match(state.fault?.error.message ?? '', /demo\.codes is not available/);
  });
});

describe('createEngineCache', () => {
  const counting = (fail: (ids: string[]) => boolean = () => false) => {
    const loads: string[][] = [];
    const engines = createEngineCache({
      nodes,
      max: 2,
      loadTables: async () => [],
      loadDefinitions: async (ids) => {
        loads.push(ids);
        if (fail(ids)) throw new Error('db down');
        return rows.filter((r) => ids.includes(r.id));
      }
    });
    const run = (versionId: string, graphs: GraphRef[] = refs) =>
      engines({ versionId, graphs, tables: [] });
    return { run, loads };
  };

  it('reuses the engine of a bundle whatever order its pins come in', async () => {
    const { run, loads } = counting();
    const first = await run('v-root');
    assert.equal(await run('v-root', [...refs].reverse()), first);
    assert.deepEqual(loads, [['v-root', 'v-child']]);
  });

  it('evicts the least recently used bundle beyond its limit', async () => {
    const { run, loads } = counting();
    const childOnly = [{ id: 'v-child', key: 'demo.child', version: 3 }];
    const bumped = [
      { id: 'v-root', key: 'demo.root', version: 1 },
      { id: 'v-child', key: 'demo.child', version: 4 }
    ];
    await run('v-root');
    await run('v-child', childOnly);
    await run('v-root');
    await run('v-root', bumped);
    await run('v-root');
    await run('v-child', childOnly);
    assert.deepEqual(loads, [
      ['v-root', 'v-child'],
      ['v-child'],
      ['v-root', 'v-child'],
      ['v-child']
    ]);
  });

  it('forgets a failed load so the next run loads again', async () => {
    let down = true;
    const { run, loads } = counting(() => down);
    await assert.rejects(() => run('v-root'), /^Error: db down$/);
    down = false;
    const { root } = await run('v-root');
    assert.deepEqual(root, { type: 'demo.root', version: 1 });
    assert.equal(loads.length, 2);
  });

  it('rejects a bundle whose pinned version has no definition', async () => {
    const { run } = counting();
    await assert.rejects(
      () => run('v-root', [...refs, { id: 'v-gone', key: 'demo.gone', version: 1 }]),
      { name: 'ValiError' }
    );
  });
});
