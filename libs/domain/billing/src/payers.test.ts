import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isValidNpi, payerDocument } from './payers.ts';

describe('claim filing codes', () => {
  it('recognizes the X12 claim filing indicator codes billers can choose', () => {
    assert.equal(payerDocument({ name: 'State', claimFiling: 'MC' }), 'State (Medicaid)');
    assert.equal(payerDocument({ name: 'Fed', claimFiling: 'OF' }), 'Fed (Other federal program)');
    assert.equal(payerDocument({ name: 'Odd', claimFiling: 'toString' }), 'Odd');
  });
});

describe('isValidNpi', () => {
  it('checks the NPI Luhn check digit', () => {
    assert.equal(isValidNpi('1234567893'), true);
    assert.equal(isValidNpi('1234567890'), false);
    assert.equal(isValidNpi('123456789'), false);
    assert.equal(isValidNpi('12345678930'), false);
    assert.equal(isValidNpi('123456789X'), false);
  });
});

describe('payer matching', () => {
  const _medicare = { id: 'p1', name: 'Medicare', claimFiling: 'MB' };
  const blue = { id: 'p2', name: 'Blue Plan', claimFiling: 'BL' };

  it('describes directory payers by name and claim filing type', () => {
    assert.equal(payerDocument(blue), 'Blue Plan (Blue Cross/Blue Shield)');
    assert.equal(payerDocument({ name: 'Other', claimFiling: 'ZZ' }), 'Other');
  });
});
