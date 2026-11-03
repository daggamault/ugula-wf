import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { feeSchema, searchFeesQuery } from './schemas.ts';

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

describe('searchFeesQuery', () => {
  it('trims the search, sorts by payer first and rejects unknown sorts', () => {
    assert.deepEqual(v.parse(searchFeesQuery, { q: ' a04 ' }), {
      q: 'a04',
      page: 1,
      pageSize: 25,
      sort: 'payer',
      dir: 'asc'
    });
    assert.equal(v.parse(searchFeesQuery, { sort: 'updated', dir: 'desc' }).sort, 'updated');
    assert.equal(v.safeParse(searchFeesQuery, { sort: 'price' }).success, false);
    assert.equal(v.safeParse(searchFeesQuery, { q: 'x'.repeat(81) }).success, false);
    assert.equal(v.safeParse(searchFeesQuery, { page: '0' }).success, false);
  });
});
