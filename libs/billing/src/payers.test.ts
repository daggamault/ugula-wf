import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_FILING_CODES, isClaimFilingCode, isValidNpi } from './payers.ts';

describe('claim filing codes', () => {
  it('recognizes the X12 claim filing indicator codes billers can choose', () => {
    assert.equal(CLAIM_FILING_CODES.MB, 'Medicare Part B');
    assert.equal(isClaimFilingCode('MC'), true);
    assert.equal(isClaimFilingCode('ZZ'), false);
    assert.equal(isClaimFilingCode('toString'), false);
  });
});

describe('isValidNpi', () => {
  it('checks the NPI Luhn check digit', () => {
    assert.equal(isValidNpi('1234567893'), true);
    assert.equal(isValidNpi('1234567890'), false);
    assert.equal(isValidNpi('123456789'), false);
  });
});
