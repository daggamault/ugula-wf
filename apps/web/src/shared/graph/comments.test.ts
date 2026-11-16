import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphDef } from '@ugula/graph';
import {
  addComment,
  boundsOf,
  commentIdOf,
  commentNodeId,
  commentsToFlow,
  framed,
  moveComments,
  removeComments,
  updateComment
} from './comments.ts';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

describe('comments', () => {
  it('adds a frame around the selection, or at the centre when nothing is selected', () => {
    const around = boundsOf([
      { x: 0, y: 0, width: 100, height: 50 },
      { x: 200, y: 100, width: 100, height: 50 }
    ]);
    assert.deepEqual(around, { x: -40, y: -88, width: 380, height: 278 });
    assert.equal(boundsOf([]), null);
    const one = addComment(def, around, { x: 0, y: 0 });
    assert.equal(one.id, 'comment1');
    assert.deepEqual(one.def.comments?.[0]?.size, { width: 380, height: 278 });
    const two = addComment(one.def, null, { x: 500, y: 500 });
    assert.equal(two.id, 'comment2');
    assert.deepEqual(two.def.comments?.[1]?.position, { x: 260, y: 360 });
  });

  it('updates, moves and removes frames, dropping the list once empty', () => {
    const { def: one } = addComment(def, null, { x: 0, y: 0 });
    const renamed = updateComment(one, 'comment1', { text: 'Pricing', color: 'info' });
    assert.deepEqual(
      [renamed.comments?.[0]?.text, renamed.comments?.[0]?.color],
      ['Pricing', 'info']
    );
    const moved = moveComments(renamed, { comment1: { x: 10.6, y: 2.2 } });
    assert.deepEqual(moved.comments?.[0]?.position, { x: 11, y: 2 });
    assert.equal('comments' in removeComments(moved, ['comment1']), false);
    assert.equal(removeComments(def, ['x']), def);
    assert.equal(moveComments(def, {}), def);
  });

  it('maps frames to canvas nodes behind the graph', () => {
    const { def: one } = addComment(def, null, { x: 0, y: 0 });
    const [node] = commentsToFlow(one);
    assert.equal(node?.id, commentNodeId('comment1'));
    assert.equal(node?.zIndex, -2);
    assert.equal(node?.width, 480);
    assert.equal(commentIdOf(node?.id ?? ''), 'comment1');
    assert.equal(commentIdOf('add1'), null);
  });

  it('finds the nodes that sit wholly inside a frame', () => {
    const frame = { x: 0, y: 0, width: 300, height: 200 };
    const ids = framed(frame, [
      { id: 'in', x: 10, y: 10, width: 100, height: 50 },
      { id: 'edge', x: 250, y: 10, width: 100, height: 50 },
      { id: 'out', x: 400, y: 400, width: 10, height: 10 }
    ]);
    assert.deepEqual(ids, ['in']);
  });
});
