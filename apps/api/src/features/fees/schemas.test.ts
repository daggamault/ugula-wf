import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { feeSchema, searchFeesQuery } from './schemas.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const issues = (input: unknown) => v.safeParse(feeSchema, input).issues?.map((i) => i.message);

describe('feeSchema', () => {
  it('normalizes codes and treats a missing payer as the default schedule', () => {
    assert.deepEqual(v.parse(feeSchema, { code: ' a0427 ', amountCents: 95000 }), {
      payerId: null,
      code: 'A0427',
      amountCents: 95000
    });
  });

  it('keeps a payer and accepts the amount bounds', () => {
    assert.deepEqual(v.parse(feeSchema, { payerId: PAYER, code: 'A0427', amountCents: 0 }), {
      payerId: PAYER,
      code: 'A0427',
      amountCents: 0
    });
    assert.equal(
      v.parse(feeSchema, { code: 'A0427', amountCents: 10_000_000 }).amountCents,
      10_000_000
    );
  });

  it('rejects payers that are not UUIDs', () => {
    assert.deepEqual(issues({ payerId: 'Medicare', code: 'A0427', amountCents: 1 }), [
      'Invalid UUID: Received "Medicare"'
    ]);
  });

  it('rejects codes that are not HCPCS', () => {
    assert.deepEqual(issues({ code: 'X1', amountCents: 1 }), ['Enter a HCPCS code like A0427']);
  });

  it('rejects negative, fractional and oversized amounts', () => {
    assert.deepEqual(issues({ code: 'A0427', amountCents: -1 }), [
      'Invalid value: Expected >=0 but received -1'
    ]);
    assert.deepEqual(issues({ code: 'A0427', amountCents: 1.5 }), [
      'Invalid integer: Received 1.5'
    ]);
    assert.deepEqual(issues({ code: 'A0427', amountCents: 10_000_001 }), [
      'Invalid value: Expected <=10000000 but received 10000001'
    ]);
  });
});

describe('searchFeesQuery', () => {
  it('trims the search and sorts by payer ascending by default', () => {
    assert.deepEqual(v.parse(searchFeesQuery, { q: ' a04 ' }), {
      q: 'a04',
      page: 1,
      pageSize: 25,
      sort: 'payer',
      dir: 'asc'
    });
  });

  it('takes every fee sort in either direction', () => {
    for (const sort of ['payer', 'code', 'amount', 'updated']) {
      assert.equal(v.parse(searchFeesQuery, { sort, dir: 'desc' }).sort, sort);
    }
  });

  it('rejects unknown sorts, long searches and pages below one', () => {
    for (const bad of [{ sort: 'price' }, { q: 'x'.repeat(81) }, { page: '0' }]) {
      assert.equal(v.safeParse(searchFeesQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});
