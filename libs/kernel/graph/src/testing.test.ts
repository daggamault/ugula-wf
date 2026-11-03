import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { actionNode, pin, pureNode } from './define.ts';
import { invokeNode } from './testing.ts';

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
});
