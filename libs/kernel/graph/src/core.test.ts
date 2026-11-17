import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE } from './compile.ts';
import { coreNodes, entryNode, inputNode, returnNode } from './core.ts';
import { pin } from './define.ts';
import type { GraphDef, NodeDef } from './types.ts';

const graph = (execIn: string[]): GraphDef => ({
  signature: {
    execIn,
    execOut: ['done'],
    inputs: [pin('a', 'number'), pin('c', 'string')],
    outputs: [pin('b', 'string')]
  },
  variables: [],
  nodes: [],
  edges: []
});

const signatureOf = (node: NodeDef, config: unknown, g: GraphDef) =>
  typeof node.signature === 'function' ? node.signature(config, { graph: g }) : node.signature;

describe('entryNode', () => {
  it('fires the graph’s exec inputs and outputs the graph’s inputs', () => {
    assert.deepEqual(signatureOf(entryNode, {}, graph(['exec', 'retry'])), {
      execIn: [],
      execOut: ['exec', 'retry'],
      inputs: [],
      outputs: [pin('a', 'number'), pin('c', 'string')]
    });
  });
});

describe('inputNode', () => {
  it('outputs one graph input by name', () => {
    assert.deepEqual(signatureOf(inputNode, { pin: 'a' }, graph(['exec'])), {
      execIn: [],
      execOut: [],
      inputs: [],
      outputs: [pin('a', 'number')]
    });
  });

  it('outputs nothing for an input the graph lacks', () => {
    assert.deepEqual(signatureOf(inputNode, { pin: 'missing' }, graph(['exec'])).outputs, []);
  });

  it('names the input it reads', () => {
    assert.equal(inputNode.summary?.({ pin: 'claimId' }), 'Input: claimId');
  });
});

describe('returnNode', () => {
  it('takes the graph’s outputs behind one exec input when the graph has exec inputs', () => {
    assert.deepEqual(signatureOf(returnNode, {}, graph(['exec', 'retry'])), {
      execIn: ['exec'],
      execOut: [],
      inputs: [pin('b', 'string')],
      outputs: []
    });
  });

  it('takes the outputs without an exec input in a pure graph', () => {
    assert.deepEqual(signatureOf(returnNode, {}, graph([])).execIn, []);
  });

  it('names the exit it finishes through, if any', () => {
    assert.equal(returnNode.summary?.({ pin: 'approved' }), 'Exit: approved');
    assert.equal(returnNode.summary?.({ pin: '' }), null);
    assert.equal(returnNode.summary?.({}), null);
  });
});

describe('coreNodes', () => {
  it('are the entry, input and return nodes, version 1', () => {
    assert.deepEqual(
      coreNodes.map((n) => [n.type, n.version, n.title]),
      [
        [ENTRY_TYPE, 1, 'Entry'],
        [INPUT_TYPE, 1, 'Get Input'],
        [RETURN_TYPE, 1, 'Return']
      ]
    );
  });

  it('are never run directly', () => {
    for (const node of coreNodes) {
      assert.throws(() => node.run({} as never), {
        message: 'Graph boundary nodes are executed by the engine'
      });
    }
  });
});
