import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isAdjustmentGroup, mergedAdjustments } from './adjudications.ts';

describe('isAdjustmentGroup', () => {
  it('knows the CAS adjustment groups', () => {
    assert.deepEqual(['CO', 'CR', 'co', 'XX', 1, 'toString'].map(isAdjustmentGroup), [
      true,
      true,
      false,
      false,
      false,
      false
    ]);
  });
});

describe('mergedAdjustments', () => {
  it('nets a reason code that a later CAS cancels', () => {
    assert.deepEqual(
      mergedAdjustments([
        { group: 'CO', reason: '45', cents: 500 },
        { group: 'CO', reason: '45', cents: -500 },
        { group: 'OA', reason: '23', cents: 1_000 }
      ]),
      [{ group: 'OA', reason: '23', cents: 1_000 }]
    );
  });
});
