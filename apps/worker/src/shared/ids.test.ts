import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isUuid } from './ids.ts';

describe('isUuid', () => {
  it('accepts only canonical UUIDs, so lookups never hit a cast error', () => {
    assert.equal(isUuid('0195F2A4-0000-7000-8000-000000000001'), true);
    assert.equal(isUuid('new'), false);
    assert.equal(isUuid('0195f2a4-0000-7000-8000-000000000001x'), false);
  });
});
