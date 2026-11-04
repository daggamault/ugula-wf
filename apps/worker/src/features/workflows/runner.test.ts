import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { setTimeout } from 'node:timers/promises';
import type { RunStatus } from '@ugula/db';
import {
  actionNode,
  createEngine,
  createStdNodes,
  ENTRY_TYPE,
  type GraphDef,
  pin,
  RETURN_TYPE,
  type RunState,
  type Values
} from '@ugula/graph';
import type { LiveEvent } from '@ugula/live';
import type { RunJob } from '@ugula/run-queue';
import type { EngineSource } from './engines.ts';
import type { ClaimedRun, RunPatch, RunStore, RunTx, TaskInsert } from './queries.ts';
import { createRunner } from './runner.ts';

const now = new Date('2026-01-01T00:00:00.000Z');

const flow: GraphDef = {
  signature: {
    execIn: ['exec'],
    execOut: [],
    inputs: [{ name: 'ms', type: 'integer' }],
    outputs: [{ name: 'doubled', type: 'number' }]
  },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'wait', type: 'std.flow.delay', version: 1 },
    { id: 'twice', type: 'std.math.multiply', version: 1, inputs: { b: { value: 2 } } },
    { id: 'ret', type: RETURN_TYPE, version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'wait', toPin: 'exec' },
    { from: 'entry', fromPin: 'ms', to: 'wait', toPin: 'ms' },
    { from: 'wait', fromPin: 'then', to: 'ret', toPin: 'exec' },
    { from: 'entry', fromPin: 'ms', to: 'twice', toPin: 'a' },
    { from: 'twice', fromPin: 'result', to: 'ret', toPin: 'doubled' }
  ]
};

const root = { type: 'test.flow', version: 1 };
const engine = createEngine({
  nodes: createStdNodes({ fetch }),
  graphs: (ref) => (ref.type === root.type ? flow : undefined)
});
const engines: EngineSource = async () => ({ engine, root });

const failing: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'stop', type: 'std.flow.fail', version: 1, inputs: { message: { value: 'payer down' } } }
  ],
  edges: [{ from: 'entry', fromPin: 'exec', to: 'stop', toPin: 'exec' }]
};

const failingEngines: EngineSource = async () => ({
  engine: createEngine({ nodes: createStdNodes({ fetch }), graphs: () => failing }),
  root
});

const fakeStore = (inputs: Values, opts: { leased?: boolean } = {}) => {
  const row = {
    status: 'running' as RunStatus,
    state: null as RunState | null,
    leased: opts.leased ?? false
  };
  const log = {
    saves: [] as RunPatch[],
    jobs: [] as RunJob[],
    checkpoints: 0,
    released: [] as RunStatus[],
    tasks: [] as TaskInsert[],
    extended: 0,
    dropped: [] as string[]
  };
  const tx: RunTx = {
    saveRun: async (_, patch) => {
      log.saves.push(patch);
      row.status = patch.status;
      row.state = patch.state;
    },
    insertSteps: async () => undefined,
    insertTask: async (t) => {
      log.tasks.push(t);
    },
    cancelTasks: async () => undefined,
    findVersion: async () => undefined,
    insertRun: async () => 'detached',
    insertChildren: async () => [],
    lockParent: async () => undefined,
    hasPendingChildren: async () => false,
    lockSignal: async () => 0,
    claimReference: async () => null,
    recoverDrafts: async () => [],
    children: async () => [],
    activeChildren: async () => [],
    enqueue: async (jobs) => {
      log.jobs.push(...jobs);
    },
    dropTimeout: async (_, waitId) => {
      log.dropped.push(waitId);
    }
  };
  const store: RunStore = {
    claim: async ({ command }) => {
      const ok =
        command.type === 'cancel'
          ? ['running', 'suspended', 'faulted'].includes(row.status)
          : !row.leased &&
            (command.type === 'advance'
              ? row.status === 'running'
              : command.type === 'resume'
                ? row.status === 'suspended' && row.state?.suspension?.id === command.suspensionId
                : row.status === 'faulted');
      if (!ok) return undefined;
      row.status = 'running';
      const run: ClaimedRun = {
        id: 'run-1',
        lease: 'lease-1',
        agencyId: 't-1',
        versionId: 'v-1',
        parentId: null,
        parentWait: null,
        inputs,
        state: row.state && (JSON.parse(JSON.stringify(row.state)) as RunState),
        graphs: []
      };
      return run;
    },
    checkpoint: async (_, state) => {
      log.checkpoints++;
      row.state = JSON.parse(JSON.stringify(state)) as RunState;
    },
    extend: async () => {
      log.extended++;
    },
    children: (parentId, waitId) => tx.children(parentId, waitId),
    release: async (_, status) => {
      log.released.push(status);
      row.status = status;
    },
    transaction: (fn) => fn(tx),
    sweep: async () => 0,
    prune: async () => 0
  };
  return { store, row, log };
};

const events: { agencyId: string; event: LiveEvent }[] = [];
const publish = async (agencyId: string, event: LiveEvent) => {
  events.push({ agencyId, event });
};

const job = (command: RunJob['command']): RunJob => ({ runId: 'run-1', command });

describe('runner', () => {
  it('starts a run, suspends on a durable timer, and completes after resume', async () => {
    const { store, row, log } = fakeStore({ ms: 1500 });
    const runner = createRunner({ store, engines, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'suspended');
    assert.deepEqual(log.jobs.at(-1)?.startAfter, '2026-01-01T00:00:01.500Z');

    const resume = log.jobs.at(-1);
    assert.ok(resume);
    await runner.process(resume);
    assert.equal(row.status, 'completed');
    assert.deepEqual(log.saves.at(-1)?.result, { pin: null, outputs: { doubled: 3000 } });
    const task = { kind: 'task', id: null, runId: 'run-1' } as const;
    assert.deepEqual(events.slice(-4), [
      { agencyId: 't-1', event: { kind: 'run', id: 'run-1', status: 'suspended', parentId: null } },
      { agencyId: 't-1', event: task },
      { agencyId: 't-1', event: { kind: 'run', id: 'run-1', status: 'completed', parentId: null } },
      { agencyId: 't-1', event: task }
    ]);

    await runner.process(resume);
    assert.equal(log.saves.length, 2);
  });

  it('yields after its step budget and re-enqueues itself', async () => {
    const { store, row, log } = fakeStore({ ms: 10 });
    const runner = createRunner({ store, engines, now: () => now, maxSteps: 1, publish });
    await runner.process(job({ type: 'advance' }));
    const resume = log.jobs.pop();
    assert.ok(resume);
    await runner.process(resume);
    assert.equal(row.status, 'running');
    assert.deepEqual(log.jobs, [job({ type: 'advance' })]);
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'completed');
  });

  it('stalls runs whose inputs are invalid on a fault task', async () => {
    const { store, row, log } = fakeStore({ ms: 'soon' });
    await createRunner({ store, engines, now: () => now, publish }).process(
      job({ type: 'advance' })
    );
    assert.equal(row.status, 'faulted');
    assert.match(JSON.stringify(log.saves[0]?.error), /expected integer/);
    assert.equal(log.tasks[0]?.kind, 'fault');
    assert.match(log.tasks[0]?.instructions ?? '', /expected integer/);
  });

  it('retries a stalled run from its last saved state', async () => {
    const { store, row, log } = fakeStore({ ms: 5 });
    let broken = true;
    const once: EngineSource = async (run) => {
      if (broken) {
        broken = false;
        throw new Error('Graph version v-1 not found');
      }
      return engines(run);
    };
    const runner = createRunner({ store, engines: once, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'faulted');
    assert.deepEqual(log.tasks[0]?.outcomes, ['retry', 'cancel']);
    await runner.process(job({ type: 'retry' }));
    assert.equal(row.status, 'suspended');
  });

  it('hands transient failures back for retry and fails runs on permanent ones', async () => {
    const flaky = fakeStore({ ms: 1 });
    const down: EngineSource = async () => {
      throw Object.assign(new Error('connect refused'), { code: 'ECONNREFUSED' });
    };
    await assert.rejects(
      () =>
        createRunner({ store: flaky.store, engines: down, now: () => now, publish }).process(
          job({ type: 'advance' })
        ),
      /connect refused/
    );
    assert.deepEqual(flaky.log.released, ['running']);

    const broken = fakeStore({ ms: 1 });
    const corrupt: EngineSource = async () => {
      throw Object.assign(new Error('invalid input syntax for type uuid'), { code: '22P02' });
    };
    await createRunner({ store: broken.store, engines: corrupt, now: () => now, publish }).process(
      job({ type: 'advance' })
    );
    assert.equal(broken.row.status, 'faulted');
    assert.match(JSON.stringify(broken.log.saves[0]?.error), /invalid input syntax/);
  });

  it('hands a transient failure back in the status its command claimed it from', async () => {
    const { store, row, log } = fakeStore({ ms: 1500 });
    let down = false;
    const flaky: EngineSource = async (run) => {
      if (down) throw Object.assign(new Error('read ETIMEDOUT'), { code: 'ETIMEDOUT' });
      return engines(run);
    };
    const runner = createRunner({ store, engines: flaky, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    const resume = log.jobs.at(-1);
    assert.ok(resume);
    down = true;
    await assert.rejects(() => runner.process(resume), /ETIMEDOUT/);
    assert.deepEqual([log.released, row.status], [['suspended'], 'suspended']);
    down = false;
    await runner.process(resume);
    assert.equal(row.status, 'completed');
  });

  it('stops without writing when another worker took the lease', async () => {
    const stolen = fakeStore({ ms: 1 });
    stolen.store.transaction = async () => {
      throw Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' });
    };
    await createRunner({ store: stolen.store, engines, now: () => now, publish }).process(
      job({ type: 'advance' })
    );
    assert.deepEqual(stolen.log.released, []);
    assert.equal(stolen.log.saves.length, 0);
  });

  it('extends its lease while a slow node runs and stops once the lease is lost', async () => {
    const slowFlow: GraphDef = {
      signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
      variables: [],
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        { id: 'slow', type: 'test.slow', version: 1 },
        { id: 'again', type: 'test.slow', version: 1 }
      ],
      edges: [
        { from: 'entry', fromPin: 'exec', to: 'slow', toPin: 'exec' },
        { from: 'slow', fromPin: 'then', to: 'again', toPin: 'exec' }
      ]
    };
    const slow = actionNode({
      type: 'test.slow',
      title: 'Slow',
      category: 'Test',
      description: 'Takes a while.',
      inputs: [],
      outputs: [],
      compute: async () => {
        await setTimeout(30);
        return {};
      }
    });
    const slowEngines: EngineSource = async () => ({
      engine: createEngine({ nodes: [...createStdNodes({ fetch }), slow], graphs: () => slowFlow }),
      root
    });
    const held = fakeStore({});
    await createRunner({
      store: held.store,
      engines: slowEngines,
      now: () => now,
      publish,
      heartbeatMs: 5
    }).process(job({ type: 'advance' }));
    assert.equal(held.row.status, 'completed');
    assert.ok(held.log.extended > 0);

    const lost = fakeStore({});
    lost.store.extend = async () => {
      throw Object.assign(new Error('lease lost'), { code: 'LEASE_LOST' });
    };
    await createRunner({
      store: lost.store,
      engines: slowEngines,
      now: () => now,
      publish,
      heartbeatMs: 5
    }).process(job({ type: 'advance' }));
    assert.equal(lost.log.saves.length, 0);
    assert.deepEqual(lost.log.released, []);
  });

  it('reopens the fault task when a skip cannot be applied', async () => {
    const { store, row, log } = fakeStore({});
    const runner = createRunner({ store, engines: failingEngines, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'faulted');
    await runner.process(job({ type: 'skip', pin: 'nope', outputs: {} }));
    assert.equal(row.status, 'faulted');
    assert.equal(log.tasks.length, 2);
    assert.notEqual(log.tasks[1]?.waitId, log.tasks[0]?.waitId);
    assert.match(log.tasks[1]?.instructions ?? '', /^Could not skip: .*no exec output "nope"/);
    assert.match(log.tasks[1]?.instructions ?? '', /Payer down/);
  });

  it('skips a failed node with every output left empty, ignoring typed outputs', async () => {
    const flaky = actionNode({
      type: 'test.flaky',
      title: 'Flaky',
      category: 'Test',
      description: 'Fails.',
      inputs: [],
      outputs: [pin('status', 'string')],
      compute: async () => {
        throw new Error('payer down');
      }
    });
    const graph: GraphDef = {
      signature: {
        execIn: ['exec'],
        execOut: [],
        inputs: [],
        outputs: [{ name: 'status', type: 'string' }]
      },
      variables: [],
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        { id: 'flaky', type: 'test.flaky', version: 1 },
        { id: 'ret', type: RETURN_TYPE, version: 1 }
      ],
      edges: [
        { from: 'entry', fromPin: 'exec', to: 'flaky', toPin: 'exec' },
        { from: 'flaky', fromPin: 'then', to: 'ret', toPin: 'exec' },
        { from: 'flaky', fromPin: 'status', to: 'ret', toPin: 'status' }
      ]
    };
    const flakyEngines: EngineSource = async () => ({
      engine: createEngine({ nodes: [...createStdNodes({ fetch }), flaky], graphs: () => graph }),
      root
    });
    const { store, row, log } = fakeStore({});
    const runner = createRunner({ store, engines: flakyEngines, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'faulted');
    await runner.process(job({ type: 'skip', pin: 'then', outputs: { status: 'typed' } }));
    assert.equal(row.status, 'faulted');
    assert.equal(log.tasks.at(-1)?.title, 'Stuck at Return');
    assert.match(log.tasks.at(-1)?.instructions ?? '', /Input "status" of "ret" is required/);
  });

  it('loads child results from the database when a map parent resumes', async () => {
    const mapFlow: GraphDef = {
      signature: {
        execIn: ['exec'],
        execOut: [],
        inputs: [],
        outputs: [{ name: 'results', type: { list: 'any' } }]
      },
      variables: [],
      nodes: [
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        {
          id: 'each',
          type: 'std.flow.map-workflow',
          version: 1,
          config: { workflow: 'demo.child', version: 1 },
          inputs: { items: { value: [{ n: 1 }, { n: 2 }] } }
        },
        { id: 'ret', type: RETURN_TYPE, version: 1 }
      ],
      edges: [
        { from: 'entry', fromPin: 'exec', to: 'each', toPin: 'exec' },
        { from: 'each', fromPin: 'then', to: 'ret', toPin: 'exec' },
        { from: 'each', fromPin: 'results', to: 'ret', toPin: 'results' }
      ]
    };
    const mapEngines: EngineSource = async () => ({
      engine: createEngine({ nodes: createStdNodes({ fetch }), graphs: () => mapFlow }),
      root
    });
    const { store, row, log } = fakeStore({});
    const plain = store.transaction;
    store.transaction = (fn) =>
      plain((tx) =>
        fn({
          ...tx,
          findVersion: async () => 'child-version',
          insertChildren: async (_, __, ___, inputs) => inputs.map((_x, i) => `c${i}`)
        })
      );
    store.children = async () => [
      { id: 'c0', status: 'completed', result: { pin: null, outputs: { n: 2 } }, error: null },
      { id: 'c1', status: 'completed', result: { pin: null, outputs: { n: 3 } }, error: null }
    ];
    const runner = createRunner({ store, engines: mapEngines, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'suspended');
    const wait = row.state?.suspension?.id ?? '';
    await runner.process(job({ type: 'resume', suspensionId: wait, payload: null }));
    assert.equal(row.status, 'completed');
    assert.deepEqual(log.saves.at(-1)?.result, {
      pin: null,
      outputs: { results: [{ n: 2 }, { n: 3 }] }
    });
  });

  it('puts an interrupted resume back where its own command can retry it', async () => {
    const { store, row, log } = fakeStore({ ms: 1500 });
    const runner = createRunner({ store, engines, now: () => now, publish });
    await runner.process(job({ type: 'advance' }));
    assert.equal(row.status, 'suspended');
    row.status = 'running';
    await runner.process(job({ type: 'advance' }));
    assert.deepEqual(log.released, ['suspended']);
    assert.equal(log.jobs.filter((j) => j.command.type === 'resume').length, 1);
  });

  it('ignores stale commands and cancels busy runs by taking over the lease', async () => {
    const idle = fakeStore({ ms: 1 });
    idle.row.status = 'completed';
    await createRunner({ store: idle.store, engines, now: () => now, publish }).process(
      job({ type: 'advance' })
    );
    assert.equal(idle.log.saves.length, 0);

    const busy = fakeStore({ ms: 1 }, { leased: true });
    await createRunner({ store: busy.store, engines, now: () => now, publish }).process(
      job({ type: 'cancel' })
    );
    assert.equal(busy.row.status, 'cancelled');
  });
});

describe('runner wakes', () => {
  const waiting: GraphDef = {
    signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
    variables: [],
    nodes: [
      { id: 'entry', type: ENTRY_TYPE, version: 1 },
      {
        id: 'wait',
        type: 'std.flow.wait-signal',
        version: 1,
        inputs: { name: { value: 'claim' }, key: { value: 'c1' }, timeoutMs: { value: 60_000 } }
      }
    ],
    edges: [{ from: 'entry', fromPin: 'exec', to: 'wait', toPin: 'exec' }]
  };
  const signalEngines: EngineSource = async () => ({
    engine: createEngine({ nodes: createStdNodes({ fetch }), graphs: () => waiting }),
    root
  });

  it('drops the pending timeout when a signal wakes a run, inside its run scope', async () => {
    const { store, log } = fakeStore({});
    const scoped: string[] = [];
    const runner = createRunner({
      store,
      engines: signalEngines,
      now: () => now,
      publish,
      within: async (ctx, work) => {
        scoped.push(`${ctx.agencyId}:${ctx.runId}:${ctx.signal.aborted}`);
        await work();
      }
    });
    await runner.process(job({ type: 'advance' }));
    const timeout = log.jobs.at(-1);
    assert.equal(typeof timeout?.id, 'string');
    const waitId = timeout?.command.type === 'resume' ? timeout.command.suspensionId : '';
    await runner.process(job({ type: 'resume', suspensionId: waitId, payload: { payload: 1 } }));
    assert.deepEqual(log.dropped, [waitId]);
    assert.deepEqual(scoped, ['t-1:run-1:false', 't-1:run-1:false']);
  });
});
