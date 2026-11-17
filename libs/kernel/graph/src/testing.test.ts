import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionNode, defineNode, next, pin, pureNode, suspend } from './define.ts';
import { invokeNode } from './testing.ts';
import type { Json } from './types.ts';

describe('invokeNode', () => {
  it('runs a node with defaults, variables and a fixed clock', async () => {
    const node = actionNode({
      type: 't.n',
      title: 'N',
      category: 'T',
      description: '',
      inputs: [pin('a', 'number', { default: 4 })],
      outputs: [pin('at', 'string'), pin('a', 'number')],
      compute: ({ a }, _, ctx) => ({ a: a ?? null, at: ctx.now.toISOString() })
    });
    const { outputs, pin: fired, signature } = await invokeNode(node);
    assert.deepEqual(outputs, { a: 4, at: '2026-03-15T10:30:00.000Z' });
    assert.equal(fired, 'then');
    assert.deepEqual(signature.execIn, ['exec']);
  });

  it('evaluates pure nodes and applies the engine checks', async () => {
    const node = pureNode({
      type: 't.p',
      title: 'P',
      category: 'T',
      description: '',
      inputs: [pin('a', 'integer')],
      outputs: [pin('b', 'integer')],
      compute: ({ a }) => ({ b: a / 2 })
    });
    const half = await invokeNode(node, { inputs: { a: 4 } });
    assert.deepEqual([half.outputs, half.pin], [{ b: 2 }, null]);
    await assert.rejects(invokeNode(node), /Input "a" of "P" is required/);
    await assert.rejects(invokeNode(node, { inputs: { a: 3 } }), /Output "b" of "P"/);
  });

  it('hands the node the variables, clock and rules given, and keeps what it writes', async () => {
    const vars = { count: 1 };
    const seen: Json[] = [];
    const node = defineNode({
      type: 't.v',
      version: 1,
      title: 'V',
      category: 'T',
      description: '',
      signature: { execIn: ['exec'], execOut: ['then'], inputs: [], outputs: [] },
      run: async (inv) => {
        seen.push(inv.vars.get('count'), inv.vars.get('missing'), inv.ctx.now.toISOString());
        seen.push(
          inv.event.type,
          (await inv.ctx.evaluate({ type: 'r', version: 1 }, {})).x ?? null
        );
        inv.vars.set('count', 2);
        return next('then');
      }
    });
    await invokeNode(node, {
      vars,
      now: new Date('2026-01-02T00:00:00.000Z'),
      evaluate: async () => ({ x: 'ruled' })
    });
    assert.deepEqual(seen, [1, null, '2026-01-02T00:00:00.000Z', 'exec', 'ruled']);
    assert.deepEqual(vars, { count: 2 });
  });

  it('has no rules unless given some and refuses inputs the node does not declare', async () => {
    const asks = defineNode({
      type: 't.a',
      version: 1,
      title: 'Asks',
      category: 'T',
      description: '',
      signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
      run: async (inv) => next(null, await inv.ctx.evaluate({ type: 'r', version: 2 }, {}))
    });
    await assert.rejects(invokeNode(asks), { message: 'Rule r@2 is not available' });
    const reads = defineNode({
      ...asks,
      run: async (inv) => next(null, { x: await inv.read('ghost') })
    });
    await assert.rejects(invokeNode(reads), { message: '"Asks" has no input "ghost"' });
  });

  it('reports no exit for a node that suspends and checks the exit a node fires', async () => {
    const waits = defineNode({
      type: 't.w',
      version: 1,
      title: 'W',
      category: 'T',
      description: '',
      signature: { execIn: ['exec'], execOut: ['then'], inputs: [], outputs: [] },
      run: (inv) =>
        inv.event.type === 'resume' ? next('else') : suspend({ kind: 'timer', data: null })
    });
    const paused = await invokeNode(waits);
    assert.deepEqual([paused.pin, paused.result.type], [null, 'suspend']);
    await assert.rejects(invokeNode(waits, { event: { type: 'resume', payload: null } }), {
      message: '"W" fired unknown exec output "else"'
    });
  });
});
