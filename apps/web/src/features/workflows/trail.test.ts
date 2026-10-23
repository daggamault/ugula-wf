import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { graphPath, parseTrail } from './trail.ts';

describe('workflow trail', () => {
  it('round-trips the chain of parent workflows through the URL', () => {
    const trail = [
      { graphId: 'g1', version: 2 },
      { graphId: 'g2', version: 1 }
    ];
    const path = graphPath('g3', 4, trail);
    assert.equal(path, '/workflows/g3?version=4&trail=g1:2,g2:1');
    assert.deepEqual(parseTrail(new URL(path, 'http://x').searchParams.get('trail')), trail);
    assert.equal(graphPath('g1', 1), '/workflows/g1?version=1');
  });

  it('ignores malformed steps', () => {
    assert.deepEqual(parseTrail('g1:0,:3,g2:x,g3:2'), [{ graphId: 'g3', version: 2 }]);
    assert.deepEqual(parseTrail(null), []);
  });
});
