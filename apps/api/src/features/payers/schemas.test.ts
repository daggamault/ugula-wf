import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { MAX_FILING_LIMIT_DAYS } from '@ugula/billing';
import * as v from 'valibot';
import { aliasParams, payerNamesQuery, payerSchema, searchPayersQuery } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('payerSchema', () => {
  it('accepts a named payer with an 837 payer ID and claim filing code', () => {
    assert.deepEqual(
      v.parse(payerSchema, { name: ' Medicare ', payerId: ' 00952 ', claimFiling: 'MB' }),
      {
        name: 'Medicare',
        payerId: '00952',
        claimFiling: 'MB',
        filingLimitDays: null
      }
    );
    assert.equal(
      v.parse(payerSchema, {
        name: 'Blue',
        payerId: 'BCBS1',
        claimFiling: 'BL',
        filingLimitDays: MAX_FILING_LIMIT_DAYS
      }).filingLimitDays,
      MAX_FILING_LIMIT_DAYS
    );
  });

  it('rejects blank or long names, malformed payer IDs, unknown codes and odd filing limits', () => {
    const base = { name: 'X', payerId: '00952', claimFiling: 'MB' };
    for (const bad of [
      { ...base, name: '  ' },
      { ...base, name: 'x'.repeat(61) },
      { ...base, payerId: '0' },
      { ...base, payerId: '00-952' },
      { ...base, payerId: 'x'.repeat(81) },
      { ...base, claimFiling: 'ZZ' },
      { ...base, filingLimitDays: 0 },
      { ...base, filingLimitDays: 1.5 },
      { ...base, filingLimitDays: MAX_FILING_LIMIT_DAYS + 1 },
      { ...base, filingLimitDays: '90' },
      { name: 'X', payerId: '00952' }
    ]) {
      assert.equal(v.safeParse(payerSchema, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('searchPayersQuery', () => {
  it('trims the search text and pages by name unless told otherwise', () => {
    assert.deepEqual(v.parse(searchPayersQuery, { q: ' blue ' }), {
      q: 'blue',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    for (const bad of [{ sort: 'updated' }, { q: 'x'.repeat(81) }, { pageSize: '1000' }]) {
      assert.equal(v.safeParse(searchPayersQuery, bad).success, false, JSON.stringify(bad));
    }
    assert.equal(v.safeParse(payerNamesQuery, { q: 'x'.repeat(81) }).success, false);
    assert.deepEqual(v.parse(payerNamesQuery, {}), {});
  });
});

describe('aliasParams', () => {
  it('needs the payer and learned name ids', () => {
    assert.ok(v.safeParse(aliasParams, { id: ID, aliasId: ID }).success);
    assert.ok(!v.safeParse(aliasParams, { id: ID, aliasId: 'a1' }).success);
    assert.ok(!v.safeParse(aliasParams, { id: 'p1', aliasId: ID }).success);
  });
});
