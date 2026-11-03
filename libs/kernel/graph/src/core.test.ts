import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { entryNode, inputNode, returnNode } from './core.ts';
import { pin } from './define.ts';
import type { GraphDef } from './types.ts';

const graph = (execIn: string[]): GraphDef => ({
  signature: {
    execIn,
    execOut: ['done'],
    inputs: [pin('a', 'number')],
    outputs: [pin('b', 'string')]
  },
  variables: [],
  nodes: [],
  edges: []
});

describe('graph boundary nodes', () => {
  it('derive their pins from the owning graph signature', () => {
    const entry =
      typeof entryNode.signature === 'function'
        ? entryNode.signature({}, { graph: graph(['exec']) })
        : entryNode.signature;
    assert.deepEqual(entry.execOut, ['exec']);
    assert.deepEqual(
      entry.outputs.map((p) => p.name),
      ['a']
    );
    const sig = (g: GraphDef) =>
      typeof returnNode.signature === 'function'
        ? returnNode.signature({}, { graph: g })
        : returnNode.signature;
    assert.deepEqual(sig(graph(['exec'])).execIn, ['exec']);
    assert.deepEqual(sig(graph([])).execIn, []);
    assert.deepEqual(
      sig(graph([])).inputs.map((p) => p.name),
      ['b']
    );
  });

  it('read one graph input by name', () => {
    const sig = (name: string) =>
      typeof inputNode.signature === 'function'
        ? inputNode.signature({ pin: name }, { graph: graph(['exec']) })
        : inputNode.signature;
    assert.deepEqual(sig('a'), {
      execIn: [],
      execOut: [],
      inputs: [],
      outputs: [pin('a', 'number')]
    });
    assert.deepEqual(sig('missing').outputs, []);
  });

  it('are never run directly', () => {
    assert.throws(() => entryNode.run({} as never), /executed by the engine/);
    assert.throws(() => inputNode.run({} as never), /executed by the engine/);
  });
});
