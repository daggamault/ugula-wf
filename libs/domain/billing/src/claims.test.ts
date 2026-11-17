import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_STATUS_LABELS, CLAIM_STATUSES } from './claims.ts';

describe('claim statuses', () => {
  it('labels every status', () => {
    assert.deepEqual(
      CLAIM_STATUSES.map((s) => CLAIM_STATUS_LABELS[s]),
      ['Needs Review']
    );
  });
});
