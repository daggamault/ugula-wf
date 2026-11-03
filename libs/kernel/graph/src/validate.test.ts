import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE } from './compile.ts';
import { pin } from './define.ts';
import { combineSources, createRegistry } from './registry.ts';
import { clampGraph, stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type { GraphDef } from './types.ts';
import { validateGraph } from './validate.ts';

const registry = createRegistry(createStdNodes({ fetch }), combineSources(stdGraphSource));

const messages = (def: GraphDef) =>
  validateGraph(def, registry).map((i) => `${i.node ?? '-'}: ${i.message}`);

const base: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [pin('n', 'number')], outputs: [] },
  variables: [{ name: 'total', type: 'number', default: 0 }],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1 },
    { id: 'set', type: 'std.var.set', version: 1, config: { name: 'total' } }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'set', toPin: 'exec' },
    { from: 'entry', fromPin: 'n', to: 'set', toPin: 'value' }
  ]
};

describe('validateGraph', () => {
  it('accepts valid graphs', () => {
    assert.deepEqual(messages(base), []);
    assert.deepEqual(messages(clampGraph), []);
  });

  it('reads graph inputs anywhere, but only inputs the graph has', () => {
    const read = (pinName: string): GraphDef => ({
      ...base,
      nodes: [...base.nodes, { id: 'n', type: INPUT_TYPE, version: 1, config: { pin: pinName } }],
      edges: [
        { from: 'entry', fromPin: 'exec', to: 'set', toPin: 'exec' },
        { from: 'n', fromPin: 'n', to: 'set', toPin: 'value' }
      ]
    });
    assert.deepEqual(messages(read('n')), []);
    assert.ok(messages(read('x')).includes('n: "x" is not an input of this graph'));
  });

  it('reports structural, typing and binding problems', () => {
    const bad: GraphDef = {
      ...base,
      variables: [...base.variables, { name: 'total', type: 'string', default: 1 }],
      nodes: [
        ...base.nodes,
        { id: 'ghost', type: 'nope', version: 1 },
        { id: 'seq', type: 'std.flow.sequence', version: 1, config: { count: 99 } },
        { id: 'up', type: 'std.text.upper', version: 1, inputs: { text: { value: 5 } } },
        {
          id: 'add',
          type: 'std.math.add',
          version: 1,
          inputs: { a: { expr: 'missing + 1' }, z: { value: 1 } }
        },
        { id: 'len', type: 'std.text.length', version: 1 },
        { id: 'gv', type: 'std.var.get', version: 1, config: { name: 'undeclared' } },
        { id: 'b1', type: 'std.flow.branch', version: 1, inputs: { condition: { value: true } } },
        { id: 'b2', type: 'std.flow.branch', version: 1, inputs: { condition: { value: true } } }
      ],
      edges: [
        ...base.edges,
        { from: 'up', fromPin: 'result', to: 'add', toPin: 'b' },
        { from: 'entry', fromPin: 'exec', to: 'b1', toPin: 'exec' },
        { from: 'up', fromPin: 'result', to: 'b1', toPin: 'exec' },
        { from: 'entry', fromPin: 'n', to: 'len', toPin: 'nope' },
        { from: 'x', fromPin: 'y', to: 'seq', toPin: 'exec' }
      ]
    };
    const found = messages(bad);
    for (const expected of [
      '-: Duplicate variable "total"',
      '-: Variable "total" default: expected string, got number',
      'ghost: Unknown node type nope@1',
      'up: Value for "text": expected string, got number',
      'add: Expression for "a" uses unknown variable "missing"',
      'add: No input "z"',
      'add: "b" expects number but got string',
      'b1: Cannot connect exec and data pins',
      'len: No input "nope"',
      '-: Edge 6 references a missing node',
      'entry: Exec output "exec" can only connect once; use a Sequence',
      'len: Input "text" is required',
      'gv: Unknown variable "undeclared"'
    ]) {
      assert.ok(
        found.includes(expected),
        `missing "${expected}" in ${JSON.stringify(found, null, 1)}`
      );
    }
    assert.ok(found.some((m) => m.startsWith('seq: Invalid config')));
  });

  it('reports duplicate names, extra entries and conflicting input sources', () => {
    const found = messages({
      ...base,
      signature: { ...base.signature, execIn: ['exec', 'n'] },
      nodes: [
        ...base.nodes,
        { id: 'entry', type: ENTRY_TYPE, version: 1 },
        {
          id: 'add',
          type: 'std.math.add',
          version: 1,
          inputs: { a: { value: 1 }, b: { expr: '1 +' } }
        }
      ],
      edges: [
        ...base.edges,
        { from: 'entry', fromPin: 'n', to: 'add', toPin: 'a' },
        { from: 'entry', fromPin: 'n', to: 'set', toPin: 'value' }
      ]
    });
    for (const expected of [
      '-: Duplicate graph pin "n"',
      'entry: Duplicate node id "entry"',
      '-: A graph can have only one Entry',
      'add: Input "a" is both connected and set',
      'add: Expression for "b": Unexpected end of expression',
      'set: Input "value" can only have one connection'
    ]) {
      assert.ok(
        found.includes(expected),
        `missing "${expected}" in ${JSON.stringify(found, null, 1)}`
      );
    }
  });

  it('enforces pure graph rules, return pins and pure cycles', () => {
    const pure: GraphDef = {
      signature: { execIn: [], execOut: [], inputs: [], outputs: [pin('x', 'number')] },
      variables: [],
      nodes: [
        { id: 'a', type: 'std.math.add', version: 1 },
        { id: 'b', type: 'std.math.add', version: 1 },
        { id: 'branch', type: 'std.flow.branch', version: 1 },
        { id: 'r', type: RETURN_TYPE, version: 1, config: { pin: 'nope' } }
      ],
      edges: [
        { from: 'a', fromPin: 'result', to: 'b', toPin: 'a' },
        { from: 'b', fromPin: 'result', to: 'a', toPin: 'a' },
        { from: 'b', fromPin: 'result', to: 'r', toPin: 'x' }
      ]
    };
    const found = messages(pure);
    assert.ok(found.includes('branch: Pure graphs can only contain pure nodes'));
    assert.ok(found.includes('r: Return pin "nope" is not an exec output of this graph'));
    assert.ok(found.includes('a: Pure nodes form a cycle'));
    assert.ok(found.includes('b: Pure nodes form a cycle'));
    assert.ok(
      messages({ ...pure, nodes: pure.nodes.filter((x) => x.id !== 'r') }).includes(
        '-: A pure graph needs exactly one Return'
      )
    );
    assert.ok(
      messages({ ...base, nodes: base.nodes.slice(1) }).includes(
        '-: Add an Entry node so execution can start'
      )
    );
  });
});
