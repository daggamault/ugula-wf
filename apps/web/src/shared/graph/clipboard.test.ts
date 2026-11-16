import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import { clipFrom, clipOf, clipText, PASTE_OFFSET, pasted } from './clipboard.ts';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [
    { id: 'entry', type: ENTRY_TYPE, version: 1, position: { x: 0, y: 0 } },
    { id: 'add1', type: 'std.math.add', version: 1, position: { x: 100, y: 0 } },
    { id: 'add2', type: 'std.math.add', version: 1, position: { x: 300, y: 0 } }
  ],
  edges: [
    { from: 'add1', fromPin: 'result', to: 'add2', toPin: 'a' },
    { from: 'entry', fromPin: 'exec', to: 'add2', toPin: 'b' }
  ],
  comments: [
    { id: 'comment1', text: 'Sums', position: { x: 0, y: 0 }, size: { width: 9, height: 9 } }
  ]
};

describe('clipboard', () => {
  it('copies the chosen nodes with only the wires between them, never the start', () => {
    const clip = clipOf(def, ['entry', 'add1', 'add2'], ['comment1']);
    assert.deepEqual(
      clip.nodes.map((n) => n.id),
      ['add1', 'add2']
    );
    assert.deepEqual(clip.edges, [def.edges[0]]);
    assert.equal(clip.comments.length, 1);
  });

  it('pastes with fresh ids, an offset and the inner wires kept', () => {
    const out = pasted(def, clipOf(def, ['add1', 'add2'], ['comment1']));
    assert.deepEqual(out.nodes, ['add3', 'add4']);
    assert.deepEqual(out.comments, ['comment2']);
    assert.deepEqual(out.def.nodes.at(-2)?.position, { x: 100 + PASTE_OFFSET, y: PASTE_OFFSET });
    assert.ok(out.def.edges.some((e) => e.from === 'add3' && e.to === 'add4' && e.toPin === 'a'));
    assert.equal(out.def.edges.length, def.edges.length + 1);
    assert.equal(out.def.comments?.length, 2);
  });

  it('reads back only well-formed clips', () => {
    const clip = clipOf(def, ['add1'], []);
    assert.deepEqual(clipFrom(clipText(clip), def), clip);
    assert.equal(clipFrom('hello', def), null);
    assert.equal(clipFrom('{"kind":"other"}', def), null);
    const bad = JSON.stringify({
      kind: 'ugula/graph-clip',
      nodes: [{ id: 1 }],
      edges: [],
      comments: []
    });
    assert.equal(clipFrom(bad, def), null);
  });
});
