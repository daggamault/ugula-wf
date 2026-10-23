import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { CompletionRequest } from './completions.ts';
import {
  CLAIM_FILING_CODES,
  isClaimFilingCode,
  isValidNpi,
  payerChoiceRequest,
  payerDocument,
  payerKey,
  payerQuery,
  suggestPayer
} from './payers.ts';

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

describe('payer matching', () => {
  it('keys payer names by their words, ignoring case, accents and punctuation', () => {
    assert.equal(payerKey('  Blue Cross/Blue-Shield of TÉXAS '), 'blue cross blue shield of texas');
    assert.equal(payerKey('UHC #2'), 'uhc 2');
    assert.ok(payerQuery('BCBS TX').endsWith('payer directory\nQuery: BCBS TX'));
  });

  const medicare = { id: 'p1', name: 'Medicare', claimFiling: 'MB' };
  const blue = { id: 'p2', name: 'Blue Plan', claimFiling: 'BL' };

  it('describes directory payers by name and claim filing type', () => {
    assert.equal(payerDocument(blue), 'Blue Plan (Blue Cross/Blue Shield)');
    assert.equal(payerDocument({ name: 'Other', claimFiling: 'ZZ' }), 'Other');
  });

  it('asks the language model to pick one numbered candidate or none', async () => {
    const request = payerChoiceRequest('BCBS TX', [medicare, blue]);
    assert.equal(
      request.user,
      'Report payer: BCBS TX\nDirectory:\n1. Medicare (Medicare Part B)\n2. Blue Plan (Blue Cross/Blue Shield)'
    );
    assert.deepEqual(request.schema.properties, {
      choice: { type: 'integer', minimum: 0, maximum: 2 }
    });
    const asked: CompletionRequest[] = [];
    const answering = (answer: unknown) => ({
      complete: async (r: CompletionRequest) => {
        asked.push(r);
        return answer;
      }
    });
    assert.equal(await suggestPayer(answering({ choice: 2 }), 'BCBS TX', [medicare, blue]), blue);
    assert.equal(await suggestPayer(answering({ choice: 0 }), 'Self Pay', [medicare, blue]), null);
    assert.equal(await suggestPayer(answering({ choice: 7 }), 'X', [medicare]), null);
    assert.equal(await suggestPayer(answering({ choice: 'one' }), 'X', [medicare]), null);
    assert.equal(await suggestPayer(answering(null), 'X', [medicare]), null);
    const before = asked.length;
    assert.equal(await suggestPayer(answering({ choice: 1 }), 'X', []), null);
    assert.equal(asked.length, before);
  });
});
