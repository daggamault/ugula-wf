import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pin } from './define.ts';
import { combineSources, createRegistry, isPure } from './registry.ts';
import { stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type { GraphDef } from './types.ts';

const owner: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [{ name: 'total', type: 'number', default: 0 }],
  nodes: [],
  edges: []
};

describe('registry', () => {
  const registry = createRegistry(
    createStdNodes({ fetch }),
    combineSources(() => undefined, stdGraphSource)
  );

  it('resolves primitives, composites and config-driven signatures', () => {
    assert.equal(registry.node({ type: 'std.math.add', version: 1 })?.title, 'Add');
    assert.equal(registry.node({ type: 'std.graph.entry', version: 1 })?.title, 'Entry');
    assert.equal(registry.graph({ type: 'std.math.add', version: 1 }), undefined);
    assert.ok(registry.graph({ type: 'std.math.clamp', version: 1 }));

    const seq = { id: 's', type: 'std.flow.sequence', version: 1, config: { count: 3 } };
    assert.deepEqual(registry.signature(seq, owner).execOut, ['then0', 'then1', 'then2']);
    const get = { id: 'g', type: 'std.var.get', version: 1, config: { name: 'total' } };
    assert.deepEqual(registry.signature(get, owner).outputs, [pin('value', 'number')]);
    const clamp = { id: 'c', type: 'std.math.clamp', version: 1 };
    assert.equal(isPure(registry.signature(clamp, owner)), true);
    assert.throws(
      () => registry.signature({ id: 'x', type: 'nope', version: 1 }, owner),
      /Unknown node type/
    );
    assert.throws(() =>
      registry.config({ id: 'b', type: 'std.flow.sequence', version: 1, config: { count: 0 } })
    );
    assert.throws(() => registry.config({ id: 'x', type: 'nope', version: 1 }), /Unknown node/);
    assert.equal(registry.graph({ type: 'nope', version: 1 }), undefined);
    assert.equal(registry.node({ type: 'std.math.add', version: 2 }), undefined);
  });

  it('asks each graph source in order until one knows the graph', () => {
    const def = (label: string): GraphDef => ({
      ...owner,
      nodes: [{ id: label, type: 'x', version: 1 }]
    });
    const source = combineSources(
      (ref) => (ref.type === 'a' ? def('first') : undefined),
      (ref) => (ref.type === 'z' ? undefined : def('second'))
    );
    assert.equal(source({ type: 'a', version: 1 })?.nodes[0]?.id, 'first');
    assert.equal(source({ type: 'b', version: 1 })?.nodes[0]?.id, 'second');
    assert.equal(source({ type: 'z', version: 1 }), undefined);
  });

  it('rejects duplicate definitions', () => {
    const nodes = createStdNodes({ fetch });
    assert.throws(
      () => createRegistry([...nodes, ...nodes.slice(0, 1)], () => undefined),
      /Duplicate node/
    );
    assert.ok(registry.nodes().length > 90);
  });
});
