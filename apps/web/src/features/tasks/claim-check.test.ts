import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isClaimCheck, placeText } from './claim-check.tsx';

describe('claim check', () => {
  it('recognizes a claim check by its lines, payers and details', () => {
    assert.equal(isClaimCheck({ lines: [], payers: [], details: {} }), true);
    assert.equal(isClaimCheck({ trip: {} }), false);
    assert.equal(isClaimCheck(null), false);
  });

  it('writes a place on one line', () => {
    assert.equal(
      placeText({
        name: 'General',
        addressLine: '2 Elm',
        city: 'Town',
        state: 'VT',
        postalCode: '05401'
      }),
      'General, 2 Elm, Town, VT 05401'
    );
    assert.equal(placeText(null), '—');
  });
});
