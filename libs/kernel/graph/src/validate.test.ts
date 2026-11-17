import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, INPUT_TYPE, RETURN_TYPE } from './compile.ts';
import { pin } from './define.ts';
import { combineSources, createRegistry } from './registry.ts';
import { clampGraph, stdGraphSource } from './std/composites.ts';
import { createStdNodes } from './std/index.ts';
import type { GraphDef } from './types.ts';
import { validateGraph } from './validate.ts';
import { mergeKinds, STD_KINDS } from './value-types.ts';

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

  it('refuses plain text where an identity is expected, and ignores comment boxes', () => {
    const typed = (from: GraphDef['signature']['inputs'][number]['type']): GraphDef => ({
      ...base,
      signature: { ...base.signature, inputs: [pin('n', from)] },
      variables: [{ name: 'total', type: { id: 'claim' }, default: null }],
      nodes: base.nodes.map((n) => ({ ...n })),
      comments: [{ id: 'c', text: 'Why', position: { x: 0, y: 0 }, size: { width: 1, height: 1 } }]
    });
    const kinds = mergeKinds(STD_KINDS, {
      id: { claim: 'Claim ID', patient: 'Patient ID' },
      code: {}
    });
    const kinded = createRegistry(createStdNodes({ fetch }), stdGraphSource, kinds);
    const check = (def: GraphDef) =>
      validateGraph(def, kinded).map((i) => `${i.node ?? '-'}: ${i.message}`);
    assert.deepEqual(check(typed({ id: 'claim' })), []);
    assert.deepEqual(check(typed('string')), ['set: "value" expects id<claim> but got string']);
    assert.deepEqual(check(typed({ id: 'patient' })), [
      'set: "value" expects id<claim> but got id<patient>'
    ]);
  });

  it('reports kinds nobody declared on pins, variables and node settings', () => {
    const def: GraphDef = {
      ...base,
      signature: { ...base.signature, inputs: [pin('n', { id: 'clam' })] },
      variables: [{ name: 'total', type: { list: { code: 'hcpc' } }, default: null }],
      nodes: [
        ...base.nodes.map((n) => ({ ...n })),
        { id: 'code', type: 'std.convert.to-code', version: 1, config: { kind: 'icd9' } }
      ]
    };
    assert.deepEqual(messages(def), [
      '-: Unknown kind id<clam> on input "n"',
      '-: Unknown kind code<hcpc> on variable "total"',
      'set: Unknown kind code<hcpc> on input "value"',
      'set: Unknown kind code<hcpc> on output "value"',
      'code: Unknown kind code<icd9> on output "code"',
      'set: "value" expects list<code<hcpc>> but got id<clam>'
    ]);
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
    assert.deepEqual(messages(read('x')), [
      'n: "x" is not an input of this graph',
      'n: No output "n"'
    ]);
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
    assert.deepEqual(messages(bad), [
      '-: Duplicate variable "total"',
      '-: Variable "total" default: expected string, got number',
      'ghost: Unknown node type nope@1',
      'seq: Invalid config: Invalid value: Expected <=32 but received 99',
      'up: Value for "text": expected string, got number',
      'add: Expression for "a" uses unknown variable "missing"',
      'add: No input "z"',
      'gv: Unknown variable "undeclared"',
      'add: "b" expects number but got string',
      'b1: Cannot connect exec and data pins',
      'len: No input "nope"',
      '-: Edge 6 references a missing node',
      'entry: Exec output "exec" can only connect once; use a Sequence',
      'len: Input "text" is required'
    ]);
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
    assert.deepEqual(found, [
      '-: Duplicate graph pin "n"',
      'entry: Duplicate node id "entry"',
      '-: A graph can have only one Entry',
      'entry: Duplicate pin "n"',
      'entry: Duplicate pin "n"',
      'add: Expression for "b": Unexpected end of expression',
      'set: Cannot connect exec and data pins',
      'add: Cannot connect exec and data pins',
      'set: Cannot connect exec and data pins',
      'entry: Exec output "n" can only connect once; use a Sequence',
      'set: Input "value" can only have one connection',
      'add: Input "a" is both connected and set'
    ]);
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
    assert.deepEqual(messages(pure), [
      'branch: Pure graphs can only contain pure nodes',
      'r: Return pin "nope" is not an exec output of this graph',
      'branch: Input "condition" is required',
      'a: Pure nodes form a cycle',
      'b: Pure nodes form a cycle'
    ]);
    assert.deepEqual(messages({ ...pure, nodes: pure.nodes.filter((x) => x.id !== 'r') }), [
      '-: A pure graph needs exactly one Return',
      'branch: Pure graphs can only contain pure nodes',
      '-: Edge 2 references a missing node',
      'branch: Input "condition" is required',
      'a: Pure nodes form a cycle',
      'b: Pure nodes form a cycle'
    ]);
    assert.deepEqual(messages({ ...base, nodes: base.nodes.slice(1) }), [
      '-: Add an Entry node so execution can start',
      '-: Edge 0 references a missing node',
      '-: Edge 1 references a missing node'
    ]);
  });
});
