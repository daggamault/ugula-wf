import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isPaymentMethod, PAYMENT_METHODS } from './deposits.ts';

describe('isPaymentMethod', () => {
  it('knows the 835 BPR04 payment methods', () => {
    assert.deepEqual(Object.keys(PAYMENT_METHODS), ['ACH', 'BOP', 'CHK', 'FWT', 'NON']);
    assert.equal(isPaymentMethod('ACH'), true);
    assert.equal(isPaymentMethod('ach'), false);
    assert.equal(isPaymentMethod(null), false);
  });
});
