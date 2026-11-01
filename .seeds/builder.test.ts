import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graph, values } from './builder.ts';

describe('graph builder', () => {
  it('adds nodes with fixed inputs and wires ports by node.pin', () => {
    const g = graph({ execIn: ['exec'], execOut: ['then'], inputs: [], outputs: [] });
    g.add('add', 'std.math.add', { label: 'Sum', values: { a: 1 } });
    g.ret('done', 'then');
    g.wire('entry.exec', 'done.exec');
    g.wire('add.result', 'done.x', 'done.y');
    assert.deepEqual(g.def.nodes[1], {
      id: 'add',
      type: 'std.math.add',
      version: 1,
      label: 'Sum',
      inputs: { a: { value: 1 } }
    });
    assert.deepEqual(g.def.nodes[2]?.config, { pin: 'then' });
    assert.equal(g.def.edges.length, 3);
    assert.deepEqual(g.def.edges[2], { from: 'add', fromPin: 'result', to: 'done', toPin: 'y' });
    assert.throws(() => g.add('add', 'x'), /Duplicate/);
    assert.throws(() => g.add('a.b', 'x'), /dots/);
    assert.deepEqual(values({ x: null }), { x: { value: null } });
  });
});
