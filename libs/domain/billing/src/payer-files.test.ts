import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isPaymentMethod,
  PAYER_FILE_KINDS,
  PAYER_FILE_LABELS,
  PAYMENT_METHODS,
  PROBLEM_OUTCOMES,
  REVIEW_OUTCOMES
} from './payer-files.ts';

describe('payer files', () => {
  it('names every kind of file a clearinghouse returns, and what needs a biller', () => {
    assert.deepEqual(
      PAYER_FILE_KINDS.map((k) => PAYER_FILE_LABELS[k]),
      [
        'Remittance (835)',
        'Acknowledgment (999)',
        'Claim acknowledgment (277CA)',
        'Eligibility response (271)',
        'Interchange acknowledgment (TA1)',
        'Claim status (277)'
      ]
    );
    assert.deepEqual(PROBLEM_OUTCOMES, ['rejected', 'ineligible', 'unmatched', 'review']);
  });

  it('spawns a line review only where no claim workflow already asks a biller', () => {
    assert.deepEqual(REVIEW_OUTCOMES, ['unmatched', 'review']);
  });

  it('knows the 835 BPR04 payment methods', () => {
    assert.deepEqual(Object.keys(PAYMENT_METHODS), ['ACH', 'BOP', 'CHK', 'FWT', 'NON']);
    assert.equal(isPaymentMethod('ACH'), true);
    assert.equal(isPaymentMethod('ach'), false);
    assert.equal(isPaymentMethod(null), false);
  });
});
