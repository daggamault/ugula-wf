import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimInput } from '@ugula/billing';
import type { LiveEvent } from '@ugula/live';
import { announceClaims } from './announce.ts';

describe('announceClaims', () => {
  it('announces the claim once it is saved', async () => {
    const announced: LiveEvent[] = [];
    const store = announceClaims(
      { saveClaim: async () => ({ id: 'c1', outcome: 'created' }) },
      async (_, event) => void announced.push(event)
    );
    assert.deepEqual(await store.saveClaim('r1', {} as ClaimInput), {
      id: 'c1',
      outcome: 'created'
    });
    assert.deepEqual(announced, [{ kind: 'claim', id: 'c1' }]);
  });
});
