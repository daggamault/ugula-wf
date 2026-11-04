import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import {
  describeDiff,
  diffGraphs,
  formatBase,
  nodeChanges,
  propertyName,
  resetProperty
} from './override-diff.ts';

const base: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 0, y: 0 } },
    { id: 'add', type: 'std.math.add', version: 1, inputs: { a: { value: 1 } } },
    { id: 'old', type: 'std.math.round', version: 1 }
  ],
  edges: [{ from: 'entry', fromPin: 'exec', to: 'add', toPin: 'exec' }]
};

const mine: GraphDef = {
  ...base,
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 50, y: 50 } },
    {
      id: 'add',
      type: 'std.math.add',
      version: 1,
      label: 'Add Fee',
      inputs: { a: { value: 2 }, b: { expr: 'x' } }
    },
    { id: 'new', type: 'std.text.upper', version: 1 }
  ],
  edges: [
    { from: 'entry', fromPin: 'exec', to: 'add', toPin: 'exec' },
    { from: 'add', fromPin: 'result', to: 'new', toPin: 'text' }
  ]
};

describe('diffGraphs', () => {
  it('finds added, changed and removed nodes and new wires, ignoring moves', () => {
    const diff = diffGraphs(base, mine);
    assert.deepEqual(diff.changes, { add: 'changed', new: 'added' });
    assert.deepEqual(diff.properties.add, [
      { property: 'label', base: undefined },
      { property: 'input:a', base: { value: 1 } },
      { property: 'input:b', base: undefined }
    ]);
    assert.deepEqual(
      diff.removed.map((n) => n.id),
      ['old']
    );
    assert.deepEqual([...diff.changedEdges], ['add:result->new:text']);
    assert.equal(diff.signatureChanged, false);
    assert.equal(diffGraphs(base, base).changedEdges.size, 0);
  });

  it('notices a changed node type and signature', () => {
    const [, , old] = base.nodes;
    assert.ok(old);
    assert.deepEqual(nodeChanges(old, { ...old, type: 'std.math.floor', version: 2 }), [
      { property: 'type', base: 'std.math.round@1' }
    ]);
    const wider = { ...base, signature: { ...base.signature, execOut: ['then'] } };
    assert.equal(diffGraphs(base, wider).signatureChanged, true);
  });
});

describe('resetProperty', () => {
  it('puts one property back the way the base has it', () => {
    const [, before] = base.nodes;
    const [, after] = mine.nodes;
    assert.ok(before && after);
    assert.equal(resetProperty(after, before, 'label').label, undefined);
    assert.deepEqual(resetProperty(after, before, 'input:a').inputs, {
      b: { expr: 'x' },
      a: { value: 1 }
    });
    assert.deepEqual(resetProperty(after, before, 'input:b').inputs, { a: { value: 2 } });
    const typed = resetProperty({ ...after, type: 'std.math.max', version: 3 }, before, 'type');
    assert.equal(typed.type, 'std.math.add');
    assert.equal(
      resetProperty({ ...after, note: 'x' }, { ...before, note: 'y' }, 'note').note,
      'y'
    );
  });
});

describe('describing changes', () => {
  it('lists node-level differences in plain words', () => {
    assert.deepEqual(
      describeDiff(base, mine, (n) => n.label ?? n.id),
      [
        'Changed Add Fee: label, input a, input b',
        'Added new',
        'Removed old',
        'Rewired 1 connection'
      ]
    );
    assert.equal(propertyName('config'), 'settings');
    assert.equal(formatBase(undefined), 'Not set');
    assert.equal(formatBase({ expr: 'x + 1' }), '= x + 1');
    assert.equal(formatBase({ value: 3 }), '3');
    assert.equal(formatBase('Plain'), 'Plain');
    assert.ok(formatBase('x'.repeat(80)).endsWith('…'));
  });
});
