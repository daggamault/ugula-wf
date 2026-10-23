import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, RETURN_TYPE, refKey } from './compile.ts';
import { actionNode, pin, pureNode } from './define.ts';
import { createEngine } from './engine.ts';
import { getPath } from './json.ts';
import { combineSources } from './registry.ts';
import { stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type {
  Edge,
  GraphDef,
  InputBinding,
  Json,
  NodeDef,
  NodeInstance,
  RunState,
  Signature,
  VariableDef
} from './types.ts';

const now = new Date('2026-01-01T00:00:00.000Z');
const cx = { runId: 'run-1', now };

const n = (
  id: string,
  type: string,
  extra: Partial<Omit<NodeInstance, 'id' | 'type'>> = {}
): NodeInstance => ({ id, type, version: 1, ...extra });

const e = (from: string, fromPin: string, to: string, toPin: string): Edge => ({
  from,
  fromPin,
  to,
  toPin
});

const val = (value: Json): InputBinding => ({ value });

const graph = (
  signature: Partial<Signature>,
  nodes: NodeInstance[],
  edges: Edge[],
  variables: VariableDef[] = []
): GraphDef => ({
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [], ...signature },
  variables,
  nodes: [n('entry', ENTRY_TYPE), ...nodes],
  edges
});

const setup = (graphs: Record<string, GraphDef>, extra: NodeDef[] = []) =>
  createEngine({
    nodes: [...createStdNodes({ fetch }), ...extra],
    graphs: combineSources(stdGraphSource, (ref) => graphs[refKey(ref)])
  });

const run = async (def: GraphDef, inputs: Record<string, Json> = {}, extra: NodeDef[] = []) => {
  const engine = setup({ 'test.main@1': def }, extra);
  const state = engine.start({ type: 'test.main', version: 1 }, inputs, { now });
  const trace = await engine.drain(state, cx);
  return { engine, state, trace };
};

const roundTrip = (state: RunState): RunState => JSON.parse(JSON.stringify(state)) as RunState;

describe('engine', () => {
  it('runs an exec chain pulling pure data and returns outputs', async () => {
    const def = graph(
      {
        inputs: [pin('a', 'number'), pin('b', 'number')],
        outputs: [pin('sum', 'number')],
        execOut: ['done']
      },
      [n('add', 'std.math.add'), n('ret', RETURN_TYPE)],
      [
        e('entry', 'exec', 'ret', 'exec'),
        e('entry', 'a', 'add', 'a'),
        e('entry', 'b', 'add', 'b'),
        e('add', 'result', 'ret', 'sum')
      ]
    );
    const { state, trace } = await run(def, { a: 2, b: 3 });
    assert.equal(state.status, 'completed');
    assert.deepEqual(state.result, { pin: 'done', outputs: { sum: 5 } });
    assert.deepEqual(
      trace.map((t) => [t.node, t.event]),
      [
        ['add', 'eval'],
        ['ret', 'exec']
      ]
    );
  });

  it('loops with for-each, accumulates variables, and honors break', async () => {
    const def = graph(
      { inputs: [pin('items', { list: 'number' })], outputs: [pin('total', 'number')] },
      [
        n('loop', 'std.flow.for-each'),
        n('stop', 'std.logic.greater', { inputs: { b: val(2) } }),
        n('check', 'std.flow.branch'),
        n('inc', 'std.var.increment', { config: { name: 'total' } }),
        n('get', 'std.var.get', { config: { name: 'total' } }),
        n('ret', RETURN_TYPE)
      ],
      [
        e('entry', 'exec', 'loop', 'exec'),
        e('entry', 'items', 'loop', 'list'),
        e('loop', 'body', 'check', 'exec'),
        e('loop', 'item', 'stop', 'a'),
        e('stop', 'result', 'check', 'condition'),
        e('check', 'true', 'loop', 'break'),
        e('check', 'false', 'inc', 'exec'),
        e('loop', 'item', 'inc', 'by'),
        e('loop', 'completed', 'ret', 'exec'),
        e('get', 'value', 'ret', 'total')
      ],
      [{ name: 'total', type: 'number', default: 0 }]
    );
    const { state } = await run(def, { items: [1, 2, 3, 4] });
    assert.equal(state.status, 'completed');
    assert.deepEqual(state.result?.outputs, { total: 3 });
    assert.deepEqual(state.stack, []);
  });

  it('runs sequence outputs in order and evaluates input expressions against variables', async () => {
    const def = graph(
      { outputs: [pin('log', { list: 'string' })] },
      [
        n('seq', 'std.flow.sequence', { config: { count: 2 } }),
        n('a', 'std.var.append', { config: { name: 'log' }, inputs: { item: val('first') } }),
        n('b', 'std.var.append', {
          config: { name: 'log' },
          inputs: { item: { expr: "'second of ' + len(log)" } }
        }),
        n('get', 'std.var.get', { config: { name: 'log' } }),
        n('ret', RETURN_TYPE)
      ],
      [
        e('entry', 'exec', 'seq', 'exec'),
        e('seq', 'then0', 'a', 'exec'),
        e('seq', 'then1', 'b', 'exec'),
        e('a', 'then', 'ret', 'exec'),
        e('get', 'value', 'ret', 'log')
      ],
      [{ name: 'log', type: { list: 'string' }, default: [] }]
    );
    const { state } = await run(def);
    assert.deepEqual(state.result?.outputs, { log: ['first'] });

    const ended = graph(
      { outputs: [] },
      def.nodes.filter((x) => x.id !== 'ret' && x.id !== 'entry'),
      def.edges.filter((x) => x.to !== 'ret')
    );
    const second = await run({ ...ended, variables: def.variables });
    assert.equal(second.state.status, 'completed');
    assert.deepEqual(
      second.trace.filter((t) => t.type === 'std.var.append').map((t) => t.outputs.length),
      [1, 2]
    );
  });

  it('composes impure composites with isolated scopes and routed exec outputs', async () => {
    const check = graph(
      {
        inputs: [pin('amount', 'number')],
        outputs: [pin('doubled', 'number')],
        execOut: ['ok', 'tooBig']
      },
      [
        n('limit', 'std.logic.greater', { inputs: { b: val(100) } }),
        n('branch', 'std.flow.branch'),
        n('twice', 'std.math.multiply', { inputs: { b: val(2) } }),
        n('ok', RETURN_TYPE, { config: { pin: 'ok' } }),
        n('big', RETURN_TYPE, { config: { pin: 'tooBig' } })
      ],
      [
        e('entry', 'exec', 'branch', 'exec'),
        e('entry', 'amount', 'limit', 'a'),
        e('limit', 'result', 'branch', 'condition'),
        e('branch', 'false', 'ok', 'exec'),
        e('branch', 'true', 'big', 'exec'),
        e('entry', 'amount', 'twice', 'a'),
        e('twice', 'result', 'ok', 'doubled'),
        e('twice', 'result', 'big', 'doubled')
      ]
    );
    const main = graph(
      { inputs: [pin('amount', 'number')], outputs: [pin('route', 'string')] },
      [
        n('check', 'test.check'),
        n('okRet', RETURN_TYPE, { inputs: { route: { expr: "'ok'" } } }),
        n('bigRet', RETURN_TYPE, { inputs: { route: val('big') } })
      ],
      [
        e('entry', 'exec', 'check', 'exec'),
        e('entry', 'amount', 'check', 'amount'),
        e('check', 'ok', 'okRet', 'exec'),
        e('check', 'tooBig', 'bigRet', 'exec')
      ]
    );
    const engine = setup({ 'test.main@1': main, 'test.check@1': check });
    const small = engine.start({ type: 'test.main', version: 1 }, { amount: 5 }, { now });
    const trace = await engine.drain(small, cx);
    assert.deepEqual(small.result?.outputs, { route: 'ok' });
    const composite = trace.find((t) => t.node === 'check');
    assert.deepEqual(composite?.outputs, { doubled: 10 });
    assert.equal(composite?.pin, 'ok');
    assert.ok(trace.some((t) => t.path === 'check/' && t.node === 'twice'));
    assert.deepEqual(Object.keys(small.scopes), []);

    const large = engine.start({ type: 'test.main', version: 1 }, { amount: 500 }, { now });
    await engine.drain(large, cx);
    assert.deepEqual(large.result?.outputs, { route: 'big' });
  });

  it('evaluates pure std composites inline', async () => {
    const def = graph(
      { inputs: [pin('x', 'number')], outputs: [pin('y', 'number')] },
      [
        n('clamp', 'std.math.clamp', { inputs: { min: val(0), max: val(10) } }),
        n('ret', RETURN_TYPE)
      ],
      [
        e('entry', 'exec', 'ret', 'exec'),
        e('entry', 'x', 'clamp', 'value'),
        e('clamp', 'result', 'ret', 'y')
      ]
    );
    assert.deepEqual((await run(def, { x: 42 })).state.result?.outputs, { y: 10 });
    assert.deepEqual((await run(def, { x: -3 })).state.result?.outputs, { y: 0 });
  });

  it('suspends durably on human tasks and resumes from serialized state', async () => {
    const def = graph(
      { outputs: [pin('note', 'string')] },
      [
        n('task', 'std.human.task', {
          config: {
            title: 'Review',
            queue: 'billing',
            fields: [{ name: 'note', type: 'string' }],
            outcomes: ['approve', 'reject']
          },
          inputs: { context: val({ claim: 'C1' }) }
        }),
        n('ret', RETURN_TYPE)
      ],
      [
        e('entry', 'exec', 'task', 'exec'),
        e('task', 'approve', 'ret', 'exec'),
        e('task', 'note', 'ret', 'note')
      ]
    );
    const { engine, state } = await run(def);
    assert.equal(state.status, 'suspended');
    assert.equal(state.suspension?.kind, 'task');
    assert.deepEqual(getPath(state.suspension?.data ?? null, 'context'), { claim: 'C1' });

    const restored = roundTrip(state);
    assert.throws(() => engine.resume(restored, 'nope', null), /not waiting/);
    engine.resume(restored, restored.suspension?.id ?? '', {
      outcome: 'approve',
      values: { note: 'looks good' },
      userId: 'u-1'
    });
    await engine.drain(restored, cx);
    assert.equal(restored.status, 'completed');
    assert.deepEqual(restored.result?.outputs, { note: 'looks good' });
  });

  it('faults with location, then retries with a stable idempotency key or skips', async () => {
    const keys: string[] = [];
    let failures = 1;
    const flaky = actionNode({
      type: 'test.flaky',
      title: 'Flaky',
      category: 'Test',
      description: 'Fails until told otherwise.',
      inputs: [],
      outputs: [pin('value', 'number')],
      compute: (_, __, ctx) => {
        keys.push(ctx.key);
        if (failures-- > 0) throw new Error('upstream unavailable');
        return { value: 7 };
      }
    });
    const def = graph(
      { outputs: [pin('value', 'number')] },
      [n('call', 'test.flaky'), n('ret', RETURN_TYPE)],
      [
        e('entry', 'exec', 'call', 'exec'),
        e('call', 'then', 'ret', 'exec'),
        e('call', 'value', 'ret', 'value')
      ]
    );
    const { engine, state, trace } = await run(def, {}, [flaky]);
    assert.equal(state.status, 'faulted');
    assert.deepEqual(state.fault?.error, {
      message: 'upstream unavailable',
      path: '',
      node: 'call'
    });
    assert.equal(trace.at(-1)?.error?.message, 'upstream unavailable');
    const failed = state.fault ? engine.nodeAt(state, state.fault.cursor) : null;
    assert.equal(failed?.title, 'Flaky');
    assert.deepEqual(failed?.signature.execOut, ['then']);
    assert.equal(
      engine.nodeAt(state, { scope: 'nope', node: 'x', event: { type: 'return' } }),
      null
    );

    const retried = roundTrip(state);
    engine.retryFault(retried);
    await engine.drain(retried, cx);
    assert.deepEqual(retried.result?.outputs, { value: 7 });
    assert.equal(keys[0], keys[1]);

    failures = 1;
    const skipped = (await run(def, {}, [flaky])).state;
    engine.skipFault(skipped, 'then', { value: 99 });
    await engine.drain(skipped, cx);
    assert.deepEqual(skipped.result?.outputs, { value: 99 });

    const loop = graph(
      { outputs: [pin('done', 'string')] },
      [n('loop', 'std.flow.for-each'), n('ret', RETURN_TYPE, { inputs: { done: val('yes') } })],
      [e('entry', 'exec', 'loop', 'exec'), e('loop', 'completed', 'ret', 'exec')]
    );
    const stuck = await run(loop);
    const at = stuck.state.fault
      ? stuck.engine.nodeAt(stuck.state, stuck.state.fault.cursor)
      : null;
    assert.deepEqual(at?.exits, ['completed']);
    assert.throws(
      () => stuck.engine.skipFault(stuck.state, 'body', { item: 1, index: 0 }),
      /cannot be skipped into "body"/
    );
    stuck.engine.skipFault(stuck.state, 'completed', {});
    await stuck.engine.drain(stuck.state, cx);
    assert.deepEqual(stuck.state.result?.outputs, { done: 'yes' });
  });

  it('applies node retry policies as durable timers', async () => {
    let failures = 2;
    const flaky = actionNode({
      type: 'test.flaky',
      title: 'Flaky',
      category: 'Test',
      description: 'Fails twice.',
      inputs: [],
      outputs: [],
      compute: () => {
        if (failures-- > 0) throw new Error('busy');
        return {};
      }
    });
    const def = graph(
      {},
      [n('call', 'test.flaky', { retry: { max: 3, delayMs: 1000, factor: 2 } })],
      [e('entry', 'exec', 'call', 'exec')]
    );
    const { engine, state } = await run(def, {}, [flaky]);
    assert.equal(state.suspension?.kind, 'timer');
    assert.equal(getPath(state.suspension?.data ?? null, 'until'), '2026-01-01T00:00:01.000Z');
    engine.resume(state, state.suspension?.id ?? '', null);
    await engine.drain(state, cx);
    assert.equal(getPath(state.suspension?.data ?? null, 'until'), '2026-01-01T00:00:02.000Z');
    engine.resume(state, state.suspension?.id ?? '', null);
    await engine.drain(state, cx);
    assert.equal(state.status, 'completed');

    failures = 1;
    const huge = graph(
      {},
      [n('call', 'test.flaky', { retry: { max: 3, delayMs: 1e16, factor: 10 } })],
      [e('entry', 'exec', 'call', 'exec')]
    );
    const child = graph(
      {},
      [
        n('wf', 'std.flow.run-workflow', {
          config: { workflow: 'child', version: 1 },
          retry: { max: 2, delayMs: 10 }
        })
      ],
      [e('entry', 'exec', 'wf', 'exec')]
    );
    const spawned = await run(child);
    const kinds: string[] = [];
    for (let i = 0; i < 10 && spawned.state.status === 'suspended'; i++) {
      const wait = spawned.state.suspension;
      kinds.push(wait?.kind ?? '');
      spawned.engine.resume(
        spawned.state,
        wait?.id ?? '',
        wait?.kind === 'workflow' ? { error: 'down' } : null
      );
      await spawned.engine.drain(spawned.state, cx);
    }
    assert.deepEqual(kinds, ['workflow', 'timer', 'workflow', 'timer', 'workflow']);
    assert.equal(spawned.state.status, 'faulted');
    spawned.engine.retryFault(spawned.state);
    await spawned.engine.drain(spawned.state, cx);
    assert.equal(spawned.state.suspension?.kind, 'workflow');

    const capped = await run(huge, {}, [flaky]);
    assert.equal(capped.state.status, 'suspended');
    assert.equal(
      getPath(capped.state.suspension?.data ?? null, 'until'),
      '2026-01-31T00:00:00.000Z'
    );
  });

  it('catches errors with try, unwinding loops and composites', async () => {
    const boom = graph(
      {},
      [n('fail', 'std.flow.fail', { inputs: { message: val('bad row') } })],
      [e('entry', 'exec', 'fail', 'exec')]
    );
    const main = graph(
      { outputs: [pin('error', 'string')] },
      [
        n('try', 'std.flow.try'),
        n('loop', 'std.flow.for-each', { inputs: { list: val([1, 2]) } }),
        n('boom', 'test.boom'),
        n('ret', RETURN_TYPE)
      ],
      [
        e('entry', 'exec', 'try', 'exec'),
        e('try', 'try', 'loop', 'exec'),
        e('loop', 'body', 'boom', 'exec'),
        e('try', 'catch', 'ret', 'exec'),
        e('try', 'error', 'ret', 'error')
      ]
    );
    const engine = setup({ 'test.main@1': main, 'test.boom@1': boom });
    const state = engine.start({ type: 'test.main', version: 1 }, {}, { now });
    await engine.drain(state, cx);
    assert.deepEqual(state.result?.outputs, { error: 'bad row' });
    assert.deepEqual(state.stack, []);
    assert.deepEqual(Object.keys(state.scopes), []);
  });

  it('memoizes pure nodes within one invocation', async () => {
    let evals = 0;
    const counted = pureNode({
      type: 'test.counted',
      title: 'Counted',
      category: 'Test',
      description: 'Counts evaluations.',
      inputs: [],
      outputs: [pin('value', 'number')],
      compute: () => ({ value: ++evals })
    });
    const def = graph(
      { outputs: [pin('sum', 'number')] },
      [n('c', 'test.counted'), n('add', 'std.math.add'), n('ret', RETURN_TYPE)],
      [
        e('entry', 'exec', 'ret', 'exec'),
        e('c', 'value', 'add', 'a'),
        e('c', 'value', 'add', 'b'),
        e('add', 'result', 'ret', 'sum')
      ]
    );
    assert.deepEqual((await run(def, {}, [counted])).state.result?.outputs, { sum: 2 });
    assert.equal(evals, 1);
  });

  it('faults on bad data with clear messages', async () => {
    const def = graph(
      { outputs: [pin('x', 'number')] },
      [n('add', 'std.math.add', { inputs: { a: val(1) } }), n('ret', RETURN_TYPE)],
      [e('entry', 'exec', 'ret', 'exec'), e('add', 'result', 'ret', 'x')]
    );
    const { state } = await run(def);
    assert.equal(state.fault?.error.message, 'Input "b" of "add" is required');
    assert.equal(state.fault?.error.node, 'add');

    const notYet = graph(
      { outputs: [pin('x', 'any')] },
      [n('loop', 'std.flow.for-each', { inputs: { list: val([]) } }), n('ret', RETURN_TYPE)],
      [e('entry', 'exec', 'ret', 'exec'), e('loop', 'item', 'ret', 'x')]
    );
    assert.match(
      (await run(notYet)).state.fault?.error.message ?? '',
      /"loop" has not produced "item" yet/
    );
  });

  it('limits recursion depth and validates run inputs', async () => {
    const rec = graph({}, [n('self', 'test.main')], [e('entry', 'exec', 'self', 'exec')]);
    const { state } = await run(rec);
    assert.match(state.fault?.error.message ?? '', /Maximum call depth/);

    const pureSelf: GraphDef = {
      signature: { execIn: [], execOut: [], inputs: [], outputs: [pin('x', 'any')] },
      variables: [],
      nodes: [n('ret', RETURN_TYPE), n('self', 'test.pure')],
      edges: [e('self', 'x', 'ret', 'x')]
    };
    const pulls = graph(
      { outputs: [pin('x', 'any')] },
      [n('p', 'test.pure'), n('ret', RETURN_TYPE)],
      [e('entry', 'exec', 'ret', 'exec'), e('p', 'x', 'ret', 'x')]
    );
    const pure = setup({ 'test.main@1': pulls, 'test.pure@1': pureSelf });
    const looping = pure.start({ type: 'test.main', version: 1 }, {}, { now });
    await pure.drain(looping, cx);
    assert.match(looping.fault?.error.message ?? '', /Maximum call depth/);

    const engine = setup({
      'test.main@1': graph({ inputs: [pin('a', 'number')] }, [], [])
    });
    const ref = { type: 'test.main', version: 1 };
    assert.throws(() => engine.start(ref, { a: 'x' }, { now }), /expected number/);
    assert.throws(() => engine.start(ref, { a: 1, extra: 1 }, { now }), /no input "extra"/);
    assert.throws(() => engine.start(ref, { a: 1 }, { now, entry: 'nope' }), /no exec input/);
    assert.throws(
      () => engine.start({ type: 'missing', version: 1 }, {}, { now }),
      /Unknown graph/
    );
  });
});
