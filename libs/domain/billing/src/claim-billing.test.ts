import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingCodeRefs, claimBillingOf } from './claim-billing.ts';

describe('claimBillingOf', () => {
  it('reads the modifiers of each line and the place of service from an 837P claim', () => {
    const billing = claimBillingOf('Medicare', {
      placeOfService: '41',
      lines: [{ code: 'A0427', modifiers: ['RH', 'QL'] }, { code: 'A0425' }, 'odd']
    });
    assert.deepEqual(billing, {
      payer: 'Medicare',
      placeOfService: '41',
      modifiers: [['RH', 'QL'], [], []]
    });
    assert.equal(claimBillingOf('Medicare', null), null);
    assert.equal(claimBillingOf('Medicare', { lines: 'none' }), null);
  });

  it('lists the modifier and place of service codes to describe', () => {
    assert.deepEqual(
      billingCodeRefs({
        payer: 'Medicare',
        placeOfService: '41',
        modifiers: [['RH'], ['RH', 'GY']]
      }),
      [
        { set: 'modifier', code: 'RH' },
        { set: 'modifier', code: 'RH' },
        { set: 'modifier', code: 'GY' },
        { set: 'pos', code: '41' }
      ]
    );
    assert.deepEqual(billingCodeRefs(null), []);
  });
});
