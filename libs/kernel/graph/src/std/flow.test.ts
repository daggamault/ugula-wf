import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type InvokeOptions, invokeNode } from '../testing.ts';
import type { Json, NodeDef, NodeEvent, NodeResult } from '../types.ts';
import {
  delayNode,
  doOnceNode,
  failNode,
  flipFlopNode,
  flowBranchNode,
  forEachNode,
  forRangeNode,
  gateNode,
  mapWorkflowNode,
  rerouteNode,
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

const RETURN: NodeEvent = { type: 'return' };

const resume = (payload: Json): NodeEvent => ({
  type: 'resume',
  payload
});

const step = (def: NodeDef, opts: InvokeOptions = {}) =>
  invokeNode(def, { now: new Date('2026-01-01T00:00:00Z'), ...opts });

const invoke = async (def: NodeDef, opts: InvokeOptions = {}) => (await step(def, opts)).result;

const pinOf = async (def: NodeDef, opts: InvokeOptions = {}) => (await step(def, opts)).pin;

const suspension = (result: NodeResult) =>
  result.type === 'suspend' ? result.suspension : assert.fail(`expected a suspension`);

describe('branch and switch', () => {
  it('branches on the condition', async () => {
    assert.equal(await pinOf(flowBranchNode, { inputs: { condition: true } }), 'true');
    assert.equal(await pinOf(flowBranchNode, { inputs: { condition: false } }), 'false');
  });

  it('switches to the case matching the value as text, or the default', async () => {
    const sw = (value: Json) =>
      pinOf(switchNode, { config: { cases: ['A', '2'] }, inputs: { value } });
    assert.equal(await sw('A'), 'A');
    assert.equal(await sw(2), '2');
    assert.equal(await sw('a'), 'default');
    assert.equal(await sw(null), 'default');
    const { signature } = await step(switchNode, { config: { cases: ['A'] } });
    assert.deepEqual(signature.execOut, ['A', 'default']);
  });

  it('rejects empty, repeated or default cases', async () => {
    for (const cases of [['a', 'a'], ['default']])
      await assert.rejects(() => invoke(switchNode, { config: { cases } }), /Cases must be unique/);
    for (const cases of [[], ['']])
      await assert.rejects(() => invoke(switchNode, { config: { cases } }), /Invalid length/);
  });
});

describe('sequence', () => {
  it('calls each step in turn, then finishes', async () => {
    assert.deepEqual(await invoke(sequenceNode), {
      type: 'call',
      pin: 'then0',
      state: { index: 0 },
      outputs: {}
    });
    assert.deepEqual(
      await invoke(sequenceNode, { config: { count: 3 }, event: RETURN, state: { index: 0 } }),
      { type: 'call', pin: 'then1', state: { index: 1 }, outputs: {} }
    );
    assert.deepEqual(await invoke(sequenceNode, { event: RETURN, state: { index: 1 } }), {
      type: 'next',
      pin: null,
      outputs: {},
      state: null
    });
  });

  it('has one exit per step, from 1 to 32', async () => {
    const { signature } = await step(sequenceNode, { config: { count: 3 } });
    assert.deepEqual(signature.execOut, ['then0', 'then1', 'then2']);
    assert.deepEqual(sequenceNode.calls?.({ count: 2 }), ['then0', 'then1']);
    assert.equal(
      (await step(sequenceNode, { config: { count: 32 } })).signature.execOut.length,
      32
    );
    for (const count of [0, 33])
      await assert.rejects(() => invoke(sequenceNode, { config: { count } }), /Invalid value/);
  });
});

describe('for each', () => {
  it('calls the body once per item, then completes', async () => {
    const first = await invoke(forEachNode, { inputs: { list: ['a', 'b'] } });
    assert.deepEqual(first, {
      type: 'call',
      pin: 'body',
      state: { items: ['a', 'b'], index: 0 },
      outputs: { item: 'a', index: 0 }
    });
    const second = await invoke(forEachNode, { event: RETURN, state: first.state ?? null });
    assert.deepEqual(second, {
      type: 'call',
      pin: 'body',
      state: { items: ['a', 'b'], index: 1 },
      outputs: { item: 'b', index: 1 }
    });
    assert.deepEqual(await invoke(forEachNode, { event: RETURN, state: second.state ?? null }), {
      type: 'next',
      pin: 'completed',
      outputs: {},
      state: null
    });
  });

  it('keeps going through the items it started with, not the list wired now', async () => {
    const next = await invoke(forEachNode, {
      event: RETURN,
      state: { items: ['a', 'b', 'c'], index: 1 },
      inputs: { list: ['x'] }
    });
    assert.deepEqual(next.outputs, { item: 'c', index: 2 });
  });

  it('completes at once for an empty list or a break', async () => {
    assert.equal(await pinOf(forEachNode, { inputs: { list: [] } }), 'completed');
    const broken = await invoke(forEachNode, {
      event: exec('break'),
      state: { items: ['a', 'b'], index: 0 }
    });
    assert.deepEqual([broken.type, broken.state], ['next', null]);
    assert.equal(await pinOf(forEachNode, { event: exec('break') }), 'completed');
  });
});

describe('for range', () => {
  it('counts from first to last inclusive', async () => {
    const first = await invoke(forRangeNode, { inputs: { first: 3, last: 4 } });
    assert.deepEqual(first, {
      type: 'call',
      pin: 'body',
      state: { index: 3, last: 4 },
      outputs: { index: 3 }
    });
    const second = await invoke(forRangeNode, { event: RETURN, state: first.state ?? null });
    assert.deepEqual(second.outputs, { index: 4 });
    assert.equal(
      await pinOf(forRangeNode, { event: RETURN, state: second.state ?? null }),
      'completed'
    );
    assert.deepEqual((await invoke(forRangeNode, { inputs: { last: 0 } })).outputs, { index: 0 });
  });

  it('completes at once when last is before first, or on a break', async () => {
    assert.equal(await pinOf(forRangeNode, { inputs: { first: 3, last: 2 } }), 'completed');
    assert.equal(await pinOf(forRangeNode, { event: exec('break') }), 'completed');
  });

  it('allows at most 100000 passes', async () => {
    assert.equal((await invoke(forRangeNode, { inputs: { first: 0, last: 99_999 } })).type, 'call');
    await assert.rejects(
      () => invoke(forRangeNode, { inputs: { first: 0, last: 100_000 } }),
      /For Range: at most 100000 iterations/
    );
  });
});

describe('while', () => {
  it('calls the body while the condition holds, counting the passes', async () => {
    assert.deepEqual(await invoke(whileNode, { inputs: { condition: true } }), {
      type: 'call',
      pin: 'body',
      state: { count: 1 },
      outputs: { iteration: 0 }
    });
    assert.deepEqual(
      await invoke(whileNode, { inputs: { condition: true }, event: RETURN, state: { count: 1 } }),
      { type: 'call', pin: 'body', state: { count: 2 }, outputs: { iteration: 1 } }
    );
    assert.equal(
      await pinOf(whileNode, { inputs: { condition: false }, event: RETURN, state: { count: 1 } }),
      'completed'
    );
  });

  it('completes when the condition is false at the start, or on a break', async () => {
    assert.equal(await pinOf(whileNode, { inputs: { condition: false } }), 'completed');
    assert.equal(await pinOf(whileNode, { event: exec('break') }), 'completed');
  });

  it('fails once it would pass its iteration limit', async () => {
    const at = (count: number) =>
      invoke(whileNode, {
        config: { maxIterations: 2 },
        inputs: { condition: true },
        event: RETURN,
        state: { count }
      });
    assert.deepEqual((await at(1)).outputs, { iteration: 1 });
    await assert.rejects(() => at(2), /While exceeded 2 iterations/);
    await assert.rejects(
      () => invoke(whileNode, { config: { maxIterations: 0 } }),
      /Invalid value/
    );
  });
});

describe('do once, gate and flip flop', () => {
  it('goes on only the first time until it is reset', async () => {
    assert.deepEqual(await invoke(doOnceNode), {
      type: 'next',
      pin: 'then',
      outputs: {},
      state: { done: true }
    });
    assert.equal(await pinOf(doOnceNode, { state: { done: true } }), null);
    assert.deepEqual(await invoke(doOnceNode, { event: exec('reset'), state: { done: true } }), {
      type: 'next',
      pin: null,
      outputs: {},
      state: { done: false }
    });
    assert.equal(await pinOf(doOnceNode, { state: { done: false } }), 'then');
  });

  it('lets the flow through only while the gate is open', async () => {
    assert.deepEqual(await invoke(gateNode, { event: exec('enter') }), {
      type: 'next',
      pin: 'exit',
      outputs: { isOpen: true }
    });
    const closed = await invoke(gateNode, { event: exec('close') });
    assert.deepEqual(
      [closed.type, closed.outputs, closed.state],
      ['next', { isOpen: false }, { open: false }]
    );
    const shut = await step(gateNode, { event: exec('enter'), state: closed.state ?? null });
    assert.deepEqual([shut.pin, shut.outputs], [null, { isOpen: false }]);
    assert.equal(await pinOf(gateNode, { event: exec('enter'), state: { open: true } }), 'exit');
  });

  it('toggles, and can start closed', async () => {
    assert.deepEqual((await invoke(gateNode, { event: exec('toggle') })).state, { open: false });
    assert.deepEqual(
      (await invoke(gateNode, { event: exec('toggle'), state: { open: false } })).state,
      { open: true }
    );
    const shut = await step(gateNode, { config: { startClosed: true }, event: exec('enter') });
    assert.deepEqual([shut.pin, shut.outputs], [null, { isOpen: false }]);
    const opened = await invoke(gateNode, { config: { startClosed: true }, event: exec('open') });
    assert.deepEqual([opened.outputs, opened.state], [{ isOpen: true }, { open: true }]);
  });

  it('alternates between its two ways', async () => {
    const a = await step(flipFlopNode);
    const b = await step(flipFlopNode, { state: a.result.state ?? null });
    const c = await step(flipFlopNode, { state: b.result.state ?? null });
    assert.deepEqual(
      [a, b, c].map((r) => [r.pin, r.outputs]),
      [
        ['a', { isA: true }],
        ['b', { isA: false }],
        ['a', { isA: true }]
      ]
    );
  });
});

describe('try and fail', () => {
  it('calls the steps to try, then goes on or catches the error', async () => {
    assert.deepEqual(await invoke(tryNode), {
      type: 'call',
      pin: 'try',
      state: null,
      outputs: {}
    });
    const caught = await step(tryNode, {
      event: { type: 'error', error: { message: 'x', path: 'a/', node: 'n' } }
    });
    assert.deepEqual([caught.pin, caught.outputs], ['catch', { error: 'x', errorNode: 'a/n' }]);
    assert.equal(await pinOf(tryNode, { event: RETURN }), 'then');
  });

  it('fails with the message given', async () => {
    await assert.rejects(() => invoke(failNode, { inputs: { message: 'stop' } }), /^Error: stop$/);
  });
});

describe('timers and signals', () => {
  it('waits for a while from the step clock, then goes on', async () => {
    assert.deepEqual(suspension(await invoke(delayNode, { inputs: { ms: 1500 } })), {
      kind: 'timer',
      data: { until: '2026-01-01T00:00:01.500Z' }
    });
    assert.equal(await pinOf(delayNode, { event: resume(null) }), 'then');
  });

  it('waits until a date and time, then goes on', async () => {
    assert.deepEqual(suspension(await invoke(waitUntilNode, { inputs: { until: '2026-02-01' } })), {
      kind: 'timer',
      data: { until: '2026-02-01T00:00:00.000Z' }
    });
    assert.equal(await pinOf(waitUntilNode, { event: resume(null) }), 'then');
  });

  it('waits for a named signal, at most for its timeout', async () => {
    const wait = await invoke(waitSignalNode, {
      inputs: { name: 'ack', key: 'C1', timeoutMs: 1000 }
    });
    assert.deepEqual(suspension(wait), {
      kind: 'signal',
      data: { name: 'ack', key: 'C1', until: '2026-01-01T00:00:01.000Z', after: null }
    });
    const seen = await invoke(waitSignalNode, { inputs: { name: 'ack', key: 'C1', after: 4 } });
    assert.deepEqual(suspension(seen).data, { name: 'ack', key: 'C1', until: null, after: 4 });
  });

  it('goes on with what the signal brought, or the timeout way', async () => {
    const got = await step(waitSignalNode, { event: resume({ payload: { ok: 1 } }) });
    assert.deepEqual([got.pin, got.outputs], ['received', { payload: { ok: 1 } }]);
    const late = await step(waitSignalNode, { event: resume({ timedOut: true }) });
    assert.deepEqual([late.pin, late.outputs], ['timeout', {}]);
    for (const payload of [null, {}, { timedOut: 'yes' }]) {
      const empty = await step(waitSignalNode, { event: resume(payload) });
      assert.deepEqual([empty.pin, empty.outputs], ['received', { payload: null }]);
    }
  });
});

describe('child workflows', () => {
  const config = { workflow: 'billing.claim', version: 2 };

  it('runs a workflow and goes on with its results', async () => {
    const start = await invoke(runWorkflowNode, { config, inputs: { inputs: { id: 1 } } });
    assert.deepEqual(suspension(start), {
      kind: 'workflow',
      data: { type: 'billing.claim', version: 2, inputs: { id: 1 } }
    });
    assert.deepEqual(suspension(await invoke(runWorkflowNode, { config })).data, {
      type: 'billing.claim',
      version: 2,
      inputs: {}
    });
    const done = await step(runWorkflowNode, {
      config,
      event: resume({ runId: 'r2', pin: 'ok', outputs: { total: 3 } })
    });
    assert.deepEqual(
      [done.pin, done.outputs],
      ['then', { runId: 'r2', pin: 'ok', outputs: { total: 3 } }]
    );
  });

  it('fails when the workflow it ran failed or gave nothing', async () => {
    await assert.rejects(
      () => invoke(runWorkflowNode, { config, event: resume({ error: 'boom' }) }),
      /Child workflow failed: boom/
    );
    await assert.rejects(
      () => invoke(runWorkflowNode, { config, event: resume(null) }),
      /Child workflow failed: no result/
    );
  });

  it('needs a workflow name and a version from 1', async () => {
    await assert.rejects(
      () => invoke(runWorkflowNode, { config: { workflow: '', version: 1 } }),
      /Invalid length/
    );
    await assert.rejects(
      () => invoke(runWorkflowNode, { config: { ...config, version: 0 } }),
      /Invalid value/
    );
  });

  it('starts a workflow without waiting for it', async () => {
    const detached = await invoke(startWorkflowNode, { config, inputs: { inputs: { id: 1 } } });
    assert.deepEqual(suspension(detached), {
      kind: 'start',
      data: { type: 'billing.claim', version: 2, inputs: { id: 1 } }
    });
    const started = await step(startWorkflowNode, { config, event: resume({ runId: 'r3' }) });
    assert.deepEqual([started.pin, started.outputs], ['then', { runId: 'r3' }]);
    await assert.rejects(
      () => invoke(startWorkflowNode, { config, event: resume({ error: 'not published' }) }),
      /Could not start workflow: not published/
    );
    await assert.rejects(
      () => invoke(startWorkflowNode, { config, event: resume(null) }),
      /Could not start workflow: no run/
    );
  });

  it('runs a workflow for each item and gives every result in order', async () => {
    const fan = await invoke(mapWorkflowNode, {
      config,
      inputs: { items: [{ id: 1 }, { id: 2 }] }
    });
    assert.deepEqual(suspension(fan), {
      kind: 'workflows',
      data: { type: 'billing.claim', version: 2, items: [{ id: 1 }, { id: 2 }] }
    });
    const all = await invoke(mapWorkflowNode, {
      config,
      event: resume({
        results: [
          { runId: 'a', outputs: { x: 1 } },
          { runId: 'b', outputs: { x: 2 } },
          { runId: 3, outputs: 'x' }
        ]
      })
    });
    assert.deepEqual(all.outputs, {
      results: [{ x: 1 }, { x: 2 }, {}],
      runIds: ['a', 'b', '']
    });
    assert.deepEqual((await invoke(mapWorkflowNode, { config, event: resume(null) })).outputs, {
      results: [],
      runIds: []
    });
  });

  it('fails when any of the workflows it ran failed', async () => {
    await assert.rejects(
      () =>
        invoke(mapWorkflowNode, {
          config,
          event: resume({ results: [{ runId: 'a' }, { error: 'bad' }, { error: 'worse' }] })
        }),
      /2 child workflow\(s\) failed: bad/
    );
  });

  it('spawns a workflow for each item without waiting', async () => {
    const spawn = await invoke(spawnWorkflowsNode, { config, inputs: { items: [{ id: 1 }] } });
    assert.deepEqual(suspension(spawn), {
      kind: 'spawn',
      data: { type: 'billing.claim', version: 2, items: [{ id: 1 }] }
    });
    const spawned = await step(spawnWorkflowsNode, {
      config,
      event: resume({ runIds: ['a', 'b'] })
    });
    assert.deepEqual([spawned.pin, spawned.outputs], ['then', { runIds: ['a', 'b'] }]);
    await assert.rejects(
      () => invoke(spawnWorkflowsNode, { config, event: resume({ error: 'not published' }) }),
      /Could not start workflows: not published/
    );
    for (const payload of [{}, null, { runIds: 'a' }]) {
      await assert.rejects(
        () => invoke(spawnWorkflowsNode, { config, event: resume(payload) }),
        /Could not start workflows: no runs/
      );
    }
  });
});

describe('called exits', () => {
  it('name the exits that run to the end before the node goes on', () => {
    for (const node of [forEachNode, forRangeNode, whileNode])
      assert.deepEqual(node.calls?.({}), ['body'], node.type);
    assert.deepEqual(tryNode.calls?.({}), ['try']);
    assert.equal(flowBranchNode.calls, undefined);
  });
});

describe('reroute', () => {
  it('passes its value through with the type it is given', async () => {
    const r = await invokeNode(rerouteNode, {
      config: { type: { id: 'claim' } },
      inputs: { value: 'c1' }
    });
    assert.deepEqual(r.result.outputs, { value: 'c1' });
    assert.deepEqual(r.signature.outputs[0]?.type, { id: 'claim' });
    assert.deepEqual((await invoke(rerouteNode)).outputs, { value: null });
    await assert.rejects(
      invokeNode(rerouteNode, { config: { type: 'number' }, inputs: { value: 'x' } }),
      /expected number/
    );
  });
});

describe('flow summaries', () => {
  it('list switch cases, count steps and name workflows', () => {
    assert.equal(switchNode.summary?.({ cases: ['a', 'b'] }), 'Cases: a, b');
    assert.equal(sequenceNode.summary?.({ count: 3 }), '3 steps');
    for (const node of [runWorkflowNode, startWorkflowNode, mapWorkflowNode, spawnWorkflowsNode]) {
      assert.equal(
        node.summary?.({ workflow: 'billing.submit', version: 1 }),
        'Workflow: billing.submit'
      );
    }
  });
});
