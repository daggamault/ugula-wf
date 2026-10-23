import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { feeSchema } from './schemas.ts';

describe('feeSchema', () => {
  it('normalizes codes and treats a blank payer as the default schedule', () => {
    assert.deepEqual(v.parse(feeSchema, { code: ' a0427 ', amountCents: 95000 }), {
      payer: null,
      code: 'A0427',
      amountCents: 95000
    });
    assert.equal(v.parse(feeSchema, { payer: '  ', code: 'A0427', amountCents: 1 }).payer, null);
    assert.equal(
      v.parse(feeSchema, { payer: ' Medicare ', code: 'A0427', amountCents: 1 }).payer,
      'Medicare'
    );
  });

  it('rejects bad codes and amounts', () => {
    const ok = (input: unknown) => v.safeParse(feeSchema, input).success;
    assert.equal(ok({ code: 'X1', amountCents: 1 }), false);
    assert.equal(ok({ code: 'A0427', amountCents: -1 }), false);
    assert.equal(ok({ code: 'A0427', amountCents: 1.5 }), false);
    assert.equal(ok({ code: 'A0427', amountCents: 100_000_000 }), false);
  });
});
