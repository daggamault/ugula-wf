import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PAYER_FILE_KINDS, PAYER_FILE_LABELS, PROBLEM_OUTCOMES } from './payer-files.ts';

describe('payer files', () => {
  it('names every kind of file a clearinghouse returns, and what needs a biller', () => {
    assert.deepEqual(
      PAYER_FILE_KINDS.map((k) => PAYER_FILE_LABELS[k]),
      [
        'Remittance (835)',
        'Acknowledgment (999)',
        'Claim acknowledgment (277CA)',
        'Eligibility response (271)'
      ]
    );
    assert.ok(PROBLEM_OUTCOMES.includes('review'));
    assert.ok(!PROBLEM_OUTCOMES.includes('posted'));
  });
});
