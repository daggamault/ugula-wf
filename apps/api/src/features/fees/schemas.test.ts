import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { feeSchema } from './schemas.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('feeSchema', () => {
  it('normalizes codes and treats a missing payer as the default schedule', () => {
    assert.deepEqual(v.parse(feeSchema, { code: ' a0427 ', amountCents: 95000 }), {
      payerId: null,
      code: 'A0427',
      amountCents: 95000
    });
    assert.equal(
      v.parse(feeSchema, { payerId: PAYER, code: 'A0427', amountCents: 1 }).payerId,
      PAYER
    );
  });

  it('rejects bad payers, codes and amounts', () => {
    const ok = (input: unknown) => v.safeParse(feeSchema, input).success;
    assert.equal(ok({ payerId: 'Medicare', code: 'A0427', amountCents: 1 }), false);
    assert.equal(ok({ code: 'X1', amountCents: 1 }), false);
    assert.equal(ok({ code: 'A0427', amountCents: -1 }), false);
    assert.equal(ok({ code: 'A0427', amountCents: 1.5 }), false);
    assert.equal(ok({ code: 'A0427', amountCents: 100_000_000 }), false);
  });
});
