import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { addressText, modifierText } from './claim-data.tsx';

describe('claim data', () => {
  it('writes an address on one line, leaving out what is missing', () => {
    assert.equal(
      addressText({
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62704'
      }),
      '1 Main St, Springfield, IL 62704'
    );
    assert.equal(
      addressText({ addressLine: null, city: null, state: 'IL', postalCode: null }),
      'IL'
    );
    assert.equal(
      addressText({ addressLine: null, city: null, state: null, postalCode: null }),
      null
    );
  });

  it('names origin and destination modifiers', () => {
    assert.match(modifierText('R') ?? '', /^R · /);
    assert.equal(modifierText('Q'), 'Q');
    assert.equal(modifierText(null), null);
  });
});
