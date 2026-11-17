import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ENTRY_TYPE, type GraphComment, type GraphDef } from '@ugula/graph';
import {
  addComment,
  boundsOf,
  commentIdOf,
  commentNodeId,
  commentsToFlow,
  framed,
  moveComments,
  nextCommentId,
  removeComments,
  updateComment
} from './comments.ts';

const def: GraphDef = {
  signature: { execIn: ['exec'], execOut: [], inputs: [], outputs: [] },
  variables: [],
  nodes: [{ id: 'entry', type: ENTRY_TYPE, version: 1 }],
  edges: []
};

const pricing: GraphComment = {
  id: 'comment1',
  text: 'Pricing',
  position: { x: 10, y: 20 },
  size: { width: 300, height: 200 }
};

const withPricing: GraphDef = { ...def, comments: [pricing] };

describe('commentNodeId and commentIdOf', () => {
  it('round-trip a comment id through its canvas node id', () => {
    assert.equal(commentNodeId('comment1'), 'comment:comment1');
    assert.equal(commentIdOf('comment:comment1'), 'comment1');
  });

  it('tell other nodes from comments', () => {
    assert.equal(commentIdOf('add1'), null);
  });
});

describe('nextCommentId', () => {
  it('takes the first free number', () => {
    assert.equal(nextCommentId(new Set()), 'comment1');
    assert.equal(nextCommentId(new Set(['comment1', 'comment3'])), 'comment2');
  });
});

describe('boundsOf', () => {
  it('frames the rects with padding and room for the title', () => {
    assert.deepEqual(
      boundsOf([
        { x: 0, y: 0, width: 100, height: 50 },
        { x: 200, y: 100, width: 100, height: 50 }
      ]),
      { x: -40, y: -88, width: 380, height: 278 }
    );
  });

  it('frames nothing without rects', () => {
    assert.equal(boundsOf([]), null);
  });
});

describe('addComment', () => {
  it('frames the given rect, rounded', () => {
    assert.deepEqual(
      addComment(def, { x: 1.4, y: 2.6, width: 99.5, height: 50.2 }, { x: 0, y: 0 }),
      {
        id: 'comment1',
        def: {
          ...def,
          comments: [
            {
              id: 'comment1',
              text: 'Comment',
              position: { x: 1, y: 3 },
              size: { width: 100, height: 50 }
            }
          ]
        }
      }
    );
  });

  it('centres a default frame on the given point without a rect', () => {
    const { id, def: next } = addComment(withPricing, null, { x: 500, y: 500 });
    assert.equal(id, 'comment2');
    assert.deepEqual(next.comments, [
      pricing,
      {
        id: 'comment2',
        text: 'Comment',
        position: { x: 260, y: 360 },
        size: { width: 480, height: 280 }
      }
    ]);
  });
});

describe('updateComment', () => {
  it('changes only the named comment', () => {
    const other = { ...pricing, id: 'comment2' };
    const next = updateComment({ ...def, comments: [pricing, other] }, 'comment1', {
      text: 'Fees',
      color: 'info'
    });
    assert.deepEqual(next.comments, [{ ...pricing, text: 'Fees', color: 'info' }, other]);
  });
});

describe('moveComments', () => {
  it('moves the named comments to rounded positions', () => {
    const other = { ...pricing, id: 'comment2' };
    const next = moveComments(
      { ...def, comments: [pricing, other] },
      { comment1: { x: 10.6, y: 2.2 } }
    );
    assert.deepEqual(next.comments, [{ ...pricing, position: { x: 11, y: 2 } }, other]);
  });

  it('leaves a graph without comments as it is', () => {
    assert.ok(moveComments(def, { comment1: { x: 1, y: 1 } }) === def);
  });
});

describe('removeComments', () => {
  it('removes the named comments', () => {
    const other = { ...pricing, id: 'comment2' };
    assert.deepEqual(
      removeComments({ ...def, comments: [pricing, other] }, ['comment1']).comments,
      [other]
    );
  });

  it('drops the comment list once it is empty', () => {
    assert.deepEqual(removeComments(withPricing, ['comment1']), def);
  });

  it('leaves a graph without comments as it is', () => {
    assert.ok(removeComments(def, ['comment1']) === def);
  });
});

describe('commentsToFlow', () => {
  it('draws each comment as a canvas node behind the graph, dragged by its handle', () => {
    assert.deepEqual(commentsToFlow(withPricing), [
      {
        id: 'comment:comment1',
        type: 'comment',
        position: { x: 10, y: 20 },
        width: 300,
        height: 200,
        zIndex: -2,
        className: 'pointer-events-none!',
        dragHandle: '.comment-handle',
        data: { comment: pricing }
      }
    ]);
  });

  it('draws nothing for a graph without comments', () => {
    assert.deepEqual(commentsToFlow(def), []);
  });
});

describe('framed', () => {
  it('finds the rects wholly inside the frame, edges included', () => {
    const frame = { x: 0, y: 0, width: 300, height: 200 };
    assert.deepEqual(
      framed(frame, [
        { id: 'in', x: 10, y: 10, width: 100, height: 50 },
        { id: 'flush', x: 0, y: 0, width: 300, height: 200 },
        { id: 'across', x: 250, y: 10, width: 100, height: 50 },
        { id: 'out', x: 400, y: 400, width: 10, height: 10 }
      ]),
      ['in', 'flush']
    );
  });
});
