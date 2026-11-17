import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { billingCodeRefs, claimBillingOf } from './claim-billing.ts';

describe('claimBillingOf', () => {
  it('reads the modifiers of each line and the place of service from an 837P claim', () => {
    assert.deepEqual(
      claimBillingOf('Medicare', {
        placeOfService: '41',
        lines: [{ code: 'A0427', modifiers: ['RH', 'QL'] }, { code: 'A0425' }, 'odd']
      }),
      { payer: 'Medicare', placeOfService: '41', modifiers: [['RH', 'QL'], [], []] }
    );
  });

  it('reads nothing from a claim that is not a record', () => {
    assert.equal(claimBillingOf('Medicare', null), null);
    assert.equal(claimBillingOf('Medicare', ['lines']), null);
  });

  it('reads nothing from a claim whose lines are not a list', () => {
    assert.equal(claimBillingOf('Medicare', { lines: 'none' }), null);
    assert.equal(claimBillingOf('Medicare', { placeOfService: '41' }), null);
  });

  it('keeps no place of service that is not text and drops blank or odd modifiers', () => {
    assert.deepEqual(
      claimBillingOf('Medicaid', {
        placeOfService: 41,
        lines: [{ modifiers: ['RH', '', 7, null] }, { modifiers: 'RH' }]
      }),
      { payer: 'Medicaid', placeOfService: null, modifiers: [['RH'], []] }
    );
  });
});

describe('billingCodeRefs', () => {
  it('lists every modifier in line order, then the place of service', () => {
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
  });

  it('lists only modifiers when there is no place of service', () => {
    assert.deepEqual(
      billingCodeRefs({ payer: 'Medicare', placeOfService: null, modifiers: [['GY']] }),
      [{ set: 'modifier', code: 'GY' }]
    );
  });

  it('lists only the place of service when no line has modifiers', () => {
    assert.deepEqual(
      billingCodeRefs({ payer: 'Medicare', placeOfService: '41', modifiers: [[], []] }),
      [{ set: 'pos', code: '41' }]
    );
  });

  it('lists nothing without billing', () => {
    assert.deepEqual(billingCodeRefs(null), []);
  });
});
