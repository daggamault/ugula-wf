import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphPath, parseTrail } from './trail.ts';

describe('graphPath', () => {
  it('links a workflow version without a trail', () => {
    assert.equal(graphPath('g1', 1), '/workflows/g1?version=1');
    assert.equal(graphPath('g1', 1, []), '/workflows/g1?version=1');
  });

  it('carries the chain of parent workflows in order', () => {
    assert.equal(
      graphPath('g3', 4, [
        { graphId: 'g1', version: 2 },
        { graphId: 'g2', version: 1 }
      ]),
      '/workflows/g3?version=4&trail=g1:2,g2:1'
    );
  });
});

describe('parseTrail', () => {
  it('reads back the trail written by graphPath', () => {
    const trail = [
      { graphId: 'g1', version: 2 },
      { graphId: 'g2', version: 1 }
    ];
    const params = new URL(graphPath('g3', 4, trail), 'http://x').searchParams;
    assert.deepEqual(parseTrail(params.get('trail')), trail);
  });

  it('is empty without a trail', () => {
    assert.deepEqual(parseTrail(null), []);
    assert.deepEqual(parseTrail(''), []);
  });

  it('drops steps without a workflow or a positive whole version', () => {
    assert.deepEqual(parseTrail('g1:0,:3,g2:x,g3:2,g4,g5:-1,g6:1.5'), [
      { graphId: 'g3', version: 2 }
    ]);
  });
});
