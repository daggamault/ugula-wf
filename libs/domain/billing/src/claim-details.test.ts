import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isOriginDestination } from './claim-details.ts';

describe('isOriginDestination', () => {
  it('takes an origin letter then a destination letter, never X as the origin', () => {
    assert.deepEqual(['RH', 'SH', 'HX', 'XH', 'R', 'RHH', 'RZ', null].map(isOriginDestination), [
      true,
      true,
      true,
      false,
      false,
      false,
      false,
      false
    ]);
  });
});
