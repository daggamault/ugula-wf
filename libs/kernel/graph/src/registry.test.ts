import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE } from './compile.ts';
import { combineSources, createRegistry, isPure } from './registry.ts';
import { clampGraph, stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type { GraphDef } from './types.ts';
import { STD_KINDS } from './value-types.ts';

const owner: GraphDef = {
  signature: { execIn: [], execOut: [], inputs: [], outputs: [] },
  variables: [{ name: 'total', type: 'number', default: 0 }],
  nodes: [],
  edges: []
};

describe('registry', () => {
  const std = createStdNodes({ fetch });
  const registry = createRegistry(
    std,
    combineSources(() => undefined, stdGraphSource)
  );

  it('resolves primitives, composites and config-driven signatures', () => {
    assert.equal(registry.node({ type: 'std.math.add', version: 1 })?.title, 'Add');
    assert.equal(registry.node({ type: 'std.graph.entry', version: 1 })?.title, 'Entry');
    assert.equal(registry.graph({ type: 'std.math.add', version: 1 }), undefined);
    assert.equal(registry.graph({ type: 'std.math.clamp', version: 1 })?.def, clampGraph);

    const seq = { id: 's', type: 'std.flow.sequence', version: 1, config: { count: 3 } };
    assert.deepEqual(registry.signature(seq, owner).execOut, ['then0', 'then1', 'then2']);
    const get = { id: 'g', type: 'std.var.get', version: 1, config: { name: 'total' } };
    assert.deepEqual(
      registry.signature(get, owner).outputs.map((p) => p.type),
      ['number']
    );
    const clamp = { id: 'c', type: 'std.math.clamp', version: 1 };
    assert.equal(registry.signature(clamp, owner), clampGraph.signature);
    assert.equal(isPure(registry.signature(clamp, owner)), true);
    assert.equal(registry.graph({ type: 'nope', version: 1 }), undefined);
    assert.equal(registry.node({ type: 'std.math.add', version: 2 }), undefined);
  });

  it('refuses unknown node types and configs its schema rejects', () => {
    assert.throws(() => registry.signature({ id: 'x', type: 'nope', version: 1 }, owner), {
      message: 'Unknown node type nope@1'
    });
    assert.throws(() => registry.config({ id: 'x', type: 'nope', version: 1 }), {
      message: 'Unknown node type nope@1'
    });
    assert.throws(
      () =>
        registry.config({ id: 'b', type: 'std.flow.sequence', version: 1, config: { count: 0 } }),
      { message: 'Invalid value: Expected >=1 but received 0' }
    );
    assert.deepEqual(registry.config({ id: 'e', type: ENTRY_TYPE, version: 1 }), {
      trigger: { kind: 'manual' }
    });
  });

  it('works a node out again in another graph, as an edited one', () => {
    const entry = { id: 'entry', type: 'std.graph.entry', version: 1 };
    const before = { ...owner, signature: { ...owner.signature, execIn: ['exec'] } };
    const after = {
      ...before,
      signature: { ...before.signature, inputs: [{ name: 'claimId', type: 'string' as const }] }
    };
    assert.deepEqual(registry.signature(entry, before).outputs, []);
    assert.deepEqual(
      registry.signature(entry, after).outputs.map((p) => p.name),
      ['claimId']
    );
  });

  it('prefers a node definition over a graph of the same type and version', () => {
    const everything = createRegistry(std, () => clampGraph);
    assert.equal(everything.graph({ type: 'std.math.add', version: 1 }), undefined);
    assert.equal(everything.graph({ type: 'acme.any', version: 7 })?.def, clampGraph);
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
    assert.equal(combineSources()({ type: 'a', version: 1 }), undefined);
  });

  it('lists the graph boundary nodes ahead of the given ones and rejects duplicates', () => {
    const types = registry.nodes().map((d) => d.type);
    assert.deepEqual(types, [ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE, ...std.map((d) => d.type)]);
    const [first] = std;
    if (!first) throw new Error('no std nodes');
    assert.throws(() => createRegistry([...std, first], () => undefined), {
      message: `Duplicate node definition ${first.type}@${first.version}`
    });
    assert.throws(() => createRegistry(registry.nodes().slice(0, 1), () => undefined), {
      message: `Duplicate node definition ${ENTRY_TYPE}@1`
    });
  });

  it('uses the standard kinds unless given others', () => {
    assert.equal(registry.kinds, STD_KINDS);
    const kinds = { id: { claim: 'Claim ID' }, code: {} };
    assert.equal(createRegistry([], () => undefined, kinds).kinds, kinds);
  });
});
