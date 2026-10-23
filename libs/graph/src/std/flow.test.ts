import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type InvokeOptions, invokeNode } from '../testing.ts';
import type { Json, NodeDef, NodeEvent } from '../types.ts';
import {
  branchNode,
  delayNode,
  doOnceNode,
  failNode,
  flipFlopNode,
  forEachNode,
  forRangeNode,
  gateNode,
  mapWorkflowNode,
  runWorkflowNode,
  sequenceNode,
  spawnWorkflowsNode,
  startWorkflowNode,
  switchNode,
  tryNode,
  waitSignalNode,
  waitUntilNode,
  whileNode
} from './flow.ts';

const exec = (pin = 'exec'): NodeEvent => ({ type: 'exec', pin });

const invoke = async (def: NodeDef, opts: InvokeOptions = {}) =>
  (await invokeNode(def, { now: new Date('2026-01-01T00:00:00Z'), ...opts })).result;

describe('flow nodes', () => {
  it('branches and switches', async () => {
    assert.equal(
      ((await invoke(branchNode, { inputs: { condition: true } })) as { pin: string }).pin,
      'true'
    );
    const sw = (value: Json) =>
      invoke(switchNode, { config: { cases: ['A', '2'] }, inputs: { value } });
    assert.equal(((await sw(2)) as { pin: string }).pin, '2');
    assert.equal(((await sw('Z')) as { pin: string }).pin, 'default');
    await assert.rejects(() => invoke(switchNode, { config: { cases: ['a', 'a'] } }));
  });

  it('drives sequences and loops through call/return', async () => {
    assert.deepEqual(await invoke(sequenceNode), {
      type: 'call',
      pin: 'then0',
      state: { index: 0 },
      outputs: {}
    });
    assert.equal(
      (
        (await invoke(sequenceNode, { event: { type: 'return' }, state: { index: 1 } })) as {
          pin: null;
        }
      ).pin,
      null
    );

    const first = await invoke(forEachNode, { inputs: { list: ['a', 'b'] } });
    assert.deepEqual(first, {
      type: 'call',
      pin: 'body',
      state: { items: ['a', 'b'], index: 0 },
      outputs: { item: 'a', index: 0 }
    });
    const second = await invoke(forEachNode, {
      event: { type: 'return' },
      state: first.state ?? null
    });
    assert.deepEqual(second.outputs, { item: 'b', index: 1 });
    const done = await invoke(forEachNode, {
      event: { type: 'return' },
      state: second.state ?? null
    });
    assert.equal((done as { pin: string }).pin, 'completed');
    assert.equal(
      ((await invoke(forEachNode, { event: exec('break') })) as { pin: string }).pin,
      'completed'
    );

    const range = await invoke(forRangeNode, { inputs: { first: 3, last: 3 } });
    assert.deepEqual(range.outputs, { index: 3 });
    assert.equal(
      (
        (await invoke(forRangeNode, { event: { type: 'return' }, state: range.state ?? null })) as {
          pin: string;
        }
      ).pin,
      'completed'
    );

    assert.equal((await invoke(whileNode, { inputs: { condition: true } })).type, 'call');
    assert.equal(
      ((await invoke(whileNode, { inputs: { condition: false } })) as { pin: string }).pin,
      'completed'
    );
    await assert.rejects(
      () =>
        invoke(whileNode, {
          config: { maxIterations: 2 },
          inputs: { condition: true },
          event: { type: 'return' },
          state: { count: 2 }
        }),
      /exceeded 2 iterations/
    );
  });

  it('keeps gate, do-once and flip-flop state', async () => {
    const once = await invoke(doOnceNode);
    assert.deepEqual([once.type === 'next' && once.pin, once.state], ['then', { done: true }]);
    assert.equal(
      ((await invoke(doOnceNode, { state: { done: true } })) as { pin: null }).pin,
      null
    );
    assert.deepEqual(
      (await invoke(doOnceNode, { event: exec('reset'), state: { done: true } })).state,
      { done: false }
    );

    assert.equal(
      ((await invoke(gateNode, { event: exec('enter') })) as { pin: string }).pin,
      'exit'
    );
    const closed = await invoke(gateNode, { event: exec('close') });
    assert.equal(
      (
        (await invoke(gateNode, { event: exec('enter'), state: closed.state ?? null })) as {
          pin: null;
        }
      ).pin,
      null
    );
    assert.deepEqual(
      (await invoke(gateNode, { event: exec('toggle'), state: { open: false } })).outputs,
      { isOpen: true }
    );

    const a = await invoke(flipFlopNode);
    const b = await invoke(flipFlopNode, { state: a.state ?? null });
    assert.deepEqual([a.outputs.isA, b.outputs.isA], [true, false]);
  });

  it('catches and raises errors', async () => {
    assert.equal((await invoke(tryNode)).type, 'call');
    assert.deepEqual(
      (
        await invoke(tryNode, {
          event: { type: 'error', error: { message: 'x', path: 'a/', node: 'n' } }
        })
      ).outputs,
      { error: 'x', errorNode: 'a/n' }
    );
    assert.equal(
      ((await invoke(tryNode, { event: { type: 'return' } })) as { pin: string }).pin,
      'then'
    );
    await assert.rejects(() => invoke(failNode, { inputs: { message: 'stop' } }), /stop/);
  });

  it('suspends for timers and signals', async () => {
    const delay = await invoke(delayNode, { inputs: { ms: 1500 } });
    assert.deepEqual(delay.type === 'suspend' && delay.suspension, {
      kind: 'timer',
      data: { until: '2026-01-01T00:00:01.500Z' }
    });
    assert.equal(
      ((await invoke(delayNode, { event: { type: 'resume', payload: null } })) as { pin: string })
        .pin,
      'then'
    );
    const until = await invoke(waitUntilNode, { inputs: { until: '2026-02-01' } });
    assert.deepEqual(until.type === 'suspend' && until.suspension.data, {
      until: '2026-02-01T00:00:00.000Z'
    });

    const wait = await invoke(waitSignalNode, {
      inputs: { name: 'ack', key: 'C1', timeoutMs: 1000 }
    });
    assert.deepEqual(wait.type === 'suspend' && wait.suspension.data, {
      name: 'ack',
      key: 'C1',
      until: '2026-01-01T00:00:01.000Z',
      after: null
    });
    const seen = await invoke(waitSignalNode, { inputs: { name: 'ack', key: 'C1', after: 4 } });
    assert.deepEqual(seen.type === 'suspend' && seen.suspension.data, {
      name: 'ack',
      key: 'C1',
      until: null,
      after: 4
    });
    const got = await invoke(waitSignalNode, {
      event: { type: 'resume', payload: { payload: { ok: 1 } } }
    });
    assert.deepEqual(
      [got.type === 'next' && got.pin, got.outputs],
      ['received', { payload: { ok: 1 } }]
    );
    const late = await invoke(waitSignalNode, {
      event: { type: 'resume', payload: { timedOut: true } }
    });
    assert.equal(late.type === 'next' && late.pin, 'timeout');
  });

  it('delegates child workflows to the host', async () => {
    const config = { workflow: 'billing.claim', version: 2 };
    const start = await invoke(runWorkflowNode, { config, inputs: { inputs: { id: 1 } } });
    assert.deepEqual(start.type === 'suspend' && start.suspension, {
      kind: 'workflow',
      data: { type: 'billing.claim', version: 2, inputs: { id: 1 } }
    });
    const done = await invoke(runWorkflowNode, {
      config,
      event: { type: 'resume', payload: { runId: 'r2', pin: 'ok', outputs: { total: 3 } } }
    });
    assert.deepEqual(done.outputs, { runId: 'r2', pin: 'ok', outputs: { total: 3 } });
    await assert.rejects(
      () =>
        invoke(runWorkflowNode, { config, event: { type: 'resume', payload: { error: 'boom' } } }),
      /Child workflow failed: boom/
    );

    const detached = await invoke(startWorkflowNode, { config, inputs: { inputs: { id: 1 } } });
    assert.deepEqual(detached.type === 'suspend' && detached.suspension, {
      kind: 'start',
      data: { type: 'billing.claim', version: 2, inputs: { id: 1 } }
    });
    const started = await invoke(startWorkflowNode, {
      config,
      event: { type: 'resume', payload: { runId: 'r3' } }
    });
    assert.deepEqual(started.type === 'next' && [started.pin, started.outputs], [
      'then',
      { runId: 'r3' }
    ]);
    await assert.rejects(
      () =>
        invoke(startWorkflowNode, {
          config,
          event: { type: 'resume', payload: { error: 'not published' } }
        }),
      /Could not start workflow: not published/
    );

    const fan = await invoke(mapWorkflowNode, {
      config,
      inputs: { items: [{ id: 1 }, { id: 2 }] }
    });
    assert.equal(fan.type === 'suspend' && fan.suspension.kind, 'workflows');
    const all = await invoke(mapWorkflowNode, {
      config,
      event: {
        type: 'resume',
        payload: {
          results: [
            { runId: 'a', outputs: { x: 1 } },
            { runId: 'b', outputs: { x: 2 } }
          ]
        }
      }
    });
    assert.deepEqual(all.outputs, { results: [{ x: 1 }, { x: 2 }], runIds: ['a', 'b'] });
    await assert.rejects(
      () =>
        invoke(mapWorkflowNode, {
          config,
          event: { type: 'resume', payload: { results: [{ error: 'bad' }] } }
        }),
      /1 child workflow\(s\) failed: bad/
    );

    const spawn = await invoke(spawnWorkflowsNode, { config, inputs: { items: [{ id: 1 }] } });
    assert.deepEqual(spawn.type === 'suspend' && spawn.suspension, {
      kind: 'spawn',
      data: { type: 'billing.claim', version: 2, items: [{ id: 1 }] }
    });
    const spawned = await invoke(spawnWorkflowsNode, {
      config,
      event: { type: 'resume', payload: { runIds: ['a', 'b'] } }
    });
    assert.deepEqual(spawned.type === 'next' && [spawned.pin, spawned.outputs], [
      'then',
      { runIds: ['a', 'b'] }
    ]);
    await assert.rejects(
      () =>
        invoke(spawnWorkflowsNode, {
          config,
          event: { type: 'resume', payload: { error: 'not published' } }
        }),
      /Could not start workflows: not published/
    );
  });
});
