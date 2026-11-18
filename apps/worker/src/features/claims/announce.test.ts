import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimInput, ClaimReview, ClaimStore } from '@ugula/billing';
import type { LiveEvent } from '@ugula/live';
import { announceClaims } from './announce.ts';

const REVIEW: ClaimReview = {
  claimId: 'c1',
  revision: 1,
  decision: 'approved',
  reviewedBy: 'u1',
  note: null
};

const announcing = (reviewOutcome: 'recorded' | 'superseded') => {
  const announced: LiveEvent[] = [];
  const inner: ClaimStore = {
    findClaim: async () => null,
    saveClaim: async () => ({ id: 'c1', revision: 1, outcome: 'created' }),
    reviewClaim: async () => reviewOutcome
  };
  return {
    store: announceClaims(inner, async (_, event) => void announced.push(event)),
    announced
  };
};

describe('announceClaims', () => {
  it('announces the claim once it is saved', async () => {
    const { store, announced } = announcing('recorded');
    assert.deepEqual(await store.saveClaim('r1', {} as ClaimInput), {
      id: 'c1',
      revision: 1,
      outcome: 'created'
    });
    assert.deepEqual(announced, [{ kind: 'claim', id: 'c1' }]);
  });

  it('announces a recorded review, and not a superseded one', async () => {
    const recorded = announcing('recorded');
    assert.equal(await recorded.store.reviewClaim('r1', REVIEW), 'recorded');
    assert.deepEqual(recorded.announced, [{ kind: 'claim', id: 'c1' }]);
    const superseded = announcing('superseded');
    assert.equal(await superseded.store.reviewClaim('r1', REVIEW), 'superseded');
    assert.deepEqual(superseded.announced, []);
  });
});
