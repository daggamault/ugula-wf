import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { clipFrom, clipOf, clipText, PASTE_OFFSET, pasted } from './clipboard.ts';

const entry = { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 0, y: 0 } };
const add1 = { id: 'add1', type: 'std.math.add', version: 1, position: { x: 100, y: 0 } };
const add2 = { id: 'add2', type: 'std.math.add', version: 1, position: { x: 300, y: 0 } };
const inner = { from: 'add1', fromPin: 'result', to: 'add2', toPin: 'a' };
const fromEntry = { from: 'entry', fromPin: 'exec', to: 'add2', toPin: 'b' };
const note = {
  id: 'comment1',
  text: 'Sums',
  position: { x: 0, y: 0 },
  size: { width: 9, height: 9 }
};

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [entry, add1, add2],
  edges: [inner, fromEntry],
  comments: [note]
};

describe('clipOf', () => {
  it('copies the chosen nodes and comments with only the wires between them', () => {
    assert.deepEqual(clipOf(def, ['add1', 'add2'], ['comment1']), {
      nodes: [add1, add2],
      edges: [inner],
      comments: [note]
    });
  });

  it('never copies the start node or the wires to it', () => {
    assert.deepEqual(clipOf(def, ['entry', 'add2']), { nodes: [add2], edges: [], comments: [] });
  });

  it('copies no comments unless they are chosen', () => {
    assert.deepEqual(clipOf(def, ['add1']).comments, []);
  });
});

describe('pasted', () => {
  it('adds the clip with fresh ids, shifted by the offset, keeping its inner wires', () => {
    const out = pasted(def, clipOf(def, ['add1', 'add2'], ['comment1']));
    assert.deepEqual(out.nodes, ['add3', 'add4']);
    assert.deepEqual(out.comments, ['comment2']);
    assert.deepEqual(out.def.nodes.slice(3), [
      { ...add1, id: 'add3', position: { x: 100 + PASTE_OFFSET, y: PASTE_OFFSET } },
      { ...add2, id: 'add4', position: { x: 300 + PASTE_OFFSET, y: PASTE_OFFSET } }
    ]);
    assert.deepEqual(out.def.edges.slice(2), [{ ...inner, from: 'add3', to: 'add4' }]);
    assert.deepEqual(out.def.comments?.slice(1), [
      { ...note, id: 'comment2', position: { x: PASTE_OFFSET, y: PASTE_OFFSET } }
    ]);
  });

  it('keeps what was already on the graph', () => {
    const out = pasted(def, clipOf(def, ['add1']));
    assert.deepEqual(out.def.nodes.slice(0, 3), def.nodes);
    assert.deepEqual(out.def.edges, def.edges);
    assert.deepEqual(out.def.comments, def.comments);
  });

  it('shifts by a given offset from the origin for a node without a position, naming a bare number node', () => {
    const out = pasted(
      def,
      { nodes: [{ id: '7', type: 't', version: 1 }], edges: [], comments: [] },
      10
    );
    assert.deepEqual(out.def.nodes.at(-1), {
      id: 'node1',
      type: 't',
      version: 1,
      position: { x: 10, y: 10 }
    });
  });

  it('drops wires to nodes left out of the clip', () => {
    const out = pasted(def, { nodes: [add2], edges: [inner], comments: [] });
    assert.deepEqual(out.def.edges, def.edges);
  });

  it('adds no comment list to a graph without comments when none are pasted', () => {
    const { comments: _, ...bare } = def;
    assert.equal('comments' in pasted(bare, clipOf(bare, ['add1'])).def, false);
  });
});

describe('clipFrom', () => {
  it('reads back a copied clip', () => {
    const clip = clipOf(def, ['add1', 'add2'], ['comment1']);
    assert.deepEqual(clipFrom(clipText(clip), def), clip);
  });

  it('ignores text that is not a clip', () => {
    assert.equal(clipFrom('hello', def), null);
    assert.equal(clipFrom('{"kind":"other","nodes":[],"edges":[],"comments":[]}', def), null);
    assert.equal(clipFrom('{"kind":"ugula/graph-clip"}', def), null);
  });

  it('ignores a clip holding malformed nodes', () => {
    const bad = JSON.stringify({
      kind: 'ugula/graph-clip',
      nodes: [{ id: 1 }],
      edges: [],
      comments: []
    });
    assert.equal(clipFrom(bad, def), null);
  });
});
