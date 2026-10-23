import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { payerSchema } from './schemas.ts';

describe('payerSchema', () => {
  it('accepts a named payer with an 837 payer ID and claim filing code', () => {
    assert.deepEqual(
      v.parse(payerSchema, { name: ' Medicare ', payerId: '00952', claimFiling: 'MB' }),
      {
        name: 'Medicare',
        payerId: '00952',
        claimFiling: 'MB'
      }
    );
    assert.equal(
      v.safeParse(payerSchema, { name: 'X', payerId: '0', claimFiling: 'MB' }).success,
      false
    );
    assert.equal(
      v.safeParse(payerSchema, { name: 'X', payerId: '00952', claimFiling: 'ZZ' }).success,
      false
    );
  });
});
