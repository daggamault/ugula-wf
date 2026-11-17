import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef, type NodeInstance } from '@ugula/graph';
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

const node = (patch: Partial<NodeInstance> = {}): NodeInstance => ({
  id: 'n',
  type: 'std.math.round',
  version: 1,
  ...patch
});

const titleOf = (n: NodeInstance) => n.label ?? n.id;

const [, baseAdd] = base.nodes;
const [, mineAdd] = mine.nodes;
if (!baseAdd || !mineAdd) throw new Error('fixture');

describe('nodeChanges', () => {
  it('finds nothing between identical nodes, even when moved', () => {
    assert.deepEqual(nodeChanges(node(), node({ position: { x: 9, y: 9 } })), []);
  });

  it('notices a changed node type or version with the base type', () => {
    assert.deepEqual(nodeChanges(node(), node({ type: 'std.math.floor', version: 2 })), [
      { property: 'type', base: 'std.math.round@1' }
    ]);
    assert.deepEqual(nodeChanges(node(), node({ version: 2 })), [
      { property: 'type', base: 'std.math.round@1' }
    ]);
  });

  it('notices label, note and settings changes with their base values', () => {
    assert.deepEqual(
      nodeChanges(
        node({ note: 'old', config: { digits: 2 } }),
        node({ label: 'Round', config: { digits: 3 } })
      ),
      [
        { property: 'label', base: undefined },
        { property: 'note', base: 'old' },
        { property: 'config', base: { digits: 2 } }
      ]
    );
  });

  it('compares settings by value, not identity', () => {
    assert.deepEqual(nodeChanges(node({ config: { a: [1] } }), node({ config: { a: [1] } })), []);
  });
});

describe('diffGraphs', () => {
  it('finds added and changed nodes with the properties that differ', () => {
    const diff = diffGraphs(base, mine);
    assert.deepEqual(diff.changes, { add: 'changed', new: 'added' });
    assert.deepEqual(diff.properties, {
      add: [
        { property: 'label', base: undefined },
        { property: 'input:a', base: { value: 1 } },
        { property: 'input:b', base: undefined }
      ]
    });
  });

  it('finds removed nodes and new wires', () => {
    const diff = diffGraphs(base, mine);
    assert.deepEqual(
      diff.removed.map((n) => n.id),
      ['old']
    );
    assert.deepEqual([...diff.changedEdges], ['add:result->new:text']);
    assert.deepEqual([...diff.removedEdges], []);
  });

  it('finds removed wires', () => {
    assert.deepEqual([...diffGraphs(mine, base).removedEdges], ['add:result->new:text']);
  });

  it('finds no differences between a graph and itself', () => {
    const diff = diffGraphs(base, base);
    assert.deepEqual(
      { ...diff, changedEdges: [...diff.changedEdges], removedEdges: [...diff.removedEdges] },
      {
        changes: {},
        properties: {},
        removed: [],
        changedEdges: [],
        removedEdges: [],
        signatureChanged: false,
        variablesChanged: false
      }
    );
  });

  it('notices changed signatures and variables', () => {
    const wider: GraphDef = {
      ...base,
      signature: { ...base.signature, execOut: ['then'] },
      variables: [{ name: 'total', type: 'number', default: 0 }]
    };
    const diff = diffGraphs(base, wider);
    assert.equal(diff.signatureChanged, true);
    assert.equal(diff.variablesChanged, true);
  });
});

describe('resetProperty', () => {
  it('drops a label the base does not have', () => {
    const reset = resetProperty(mineAdd, baseAdd, 'label');
    assert.equal(Object.hasOwn(reset, 'label'), false);
    assert.deepEqual(reset.inputs, mineAdd.inputs);
  });

  it('restores an input the base sets and drops one it does not', () => {
    assert.deepEqual(resetProperty(mineAdd, baseAdd, 'input:a').inputs, {
      b: { expr: 'x' },
      a: { value: 1 }
    });
    assert.deepEqual(resetProperty(mineAdd, baseAdd, 'input:b').inputs, { a: { value: 2 } });
  });

  it('restores the base node type and version, keeping the rest', () => {
    const typed = resetProperty({ ...mineAdd, type: 'std.math.max', version: 3 }, baseAdd, 'type');
    assert.deepEqual([typed.type, typed.version, typed.label], ['std.math.add', 1, 'Add Fee']);
  });

  it('restores the note and settings the base has', () => {
    assert.equal(resetProperty(node({ note: 'x' }), node({ note: 'y' }), 'note').note, 'y');
    assert.deepEqual(
      resetProperty(node({ config: { a: 2 } }), node({ config: { a: 1 } }), 'config').config,
      { a: 1 }
    );
  });
});

describe('propertyName', () => {
  it('names each property in plain words', () => {
    assert.deepEqual(
      (['type', 'label', 'note', 'config', 'input:amount'] as const).map(propertyName),
      ['node type', 'label', 'note', 'settings', 'input amount']
    );
  });
});

describe('formatBase', () => {
  it('says when the base has no value', () => {
    assert.equal(formatBase(undefined), 'Not set');
  });

  it('shows formulas, fixed values, text and other JSON', () => {
    assert.equal(formatBase({ expr: 'x + 1' }), '= x + 1');
    assert.equal(formatBase({ value: 3 }), '3');
    assert.equal(formatBase({ value: 'a' }), '"a"');
    assert.equal(formatBase('Plain'), 'Plain');
    assert.equal(formatBase([1, 2]), '[1,2]');
    assert.equal(formatBase(null), 'null');
    assert.equal(formatBase({ digits: 2 }), '{"digits":2}');
  });

  it('shortens values past 60 characters', () => {
    assert.equal(formatBase('x'.repeat(60)), 'x'.repeat(60));
    assert.equal(formatBase('x'.repeat(61)), `${'x'.repeat(59)}…`);
  });
});

describe('describeDiff', () => {
  it('lists node-level differences in plain words', () => {
    assert.deepEqual(describeDiff(base, mine, titleOf), [
      'Changed Add Fee: label, input a, input b',
      'Added new',
      'Removed old',
      'Rewired 1 connection'
    ]);
  });

  it('mentions signature and variable changes first and counts several new wires', () => {
    const rewired: GraphDef = {
      ...mine,
      signature: { ...base.signature, execOut: ['then'] },
      variables: [{ name: 'total', type: 'number', default: 0 }],
      edges: [...mine.edges, { from: 'add', fromPin: 'result', to: 'add', toPin: 'b' }]
    };
    assert.deepEqual(describeDiff(base, rewired, titleOf), [
      'Changed its inputs, outputs or exits',
      'Changed its variables',
      'Changed Add Fee: label, input a, input b',
      'Added new',
      'Removed old',
      'Rewired 2 connections'
    ]);
  });

  it('treats comment boxes as layout, like moves', () => {
    const commented: GraphDef = {
      ...base,
      comments: [
        { id: 'c1', text: 'Pricing', position: { x: 0, y: 0 }, size: { width: 200, height: 100 } }
      ]
    };
    assert.deepEqual(describeDiff(base, commented, titleOf), []);
    assert.deepEqual(describeDiff(commented, base, titleOf), []);
  });

  it('counts wires that were removed', () => {
    assert.deepEqual(describeDiff(base, { ...base, edges: [] }, titleOf), ['Removed 1 connection']);
  });

  it('counts a moved wire as rewired and removed', () => {
    const moved: GraphDef = {
      ...base,
      edges: [{ from: 'entry', fromPin: 'exec', to: 'old', toPin: 'exec' }]
    };
    assert.deepEqual(describeDiff(base, moved, titleOf), [
      'Rewired 1 connection',
      'Removed 1 connection'
    ]);
  });
});
