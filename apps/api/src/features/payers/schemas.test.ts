import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CLAIM_FILING_CODES,
  CORRECTION_METHODS,
  MAX_APPEAL_DAYS,
  MAX_FILING_LIMIT_DAYS,
  PLAN_TYPES
} from '@ugula/billing';
import * as v from 'valibot';
import { aliasParams, listPayerNamesQuery, payerSchema, searchPayersQuery } from './schemas.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const BASE = { name: 'X', payerCode: '00952', claimFiling: 'MB' };

const issues = (input: unknown) =>
  v.safeParse(payerSchema, { ...BASE, ...(input as object) }).issues?.map((i) => i.message);

const choices = (values: object) =>
  Object.keys(values)
    .map((s) => `"${s}"`)
    .join(' | ');

describe('payerSchema', () => {
  it('trims a named payer with an 837 payer ID and defaults the optional settings', () => {
    assert.deepEqual(
      v.parse(payerSchema, { name: ' Medicare ', payerCode: ' 00952 ', claimFiling: 'MB' }),
      {
        name: 'Medicare',
        payerCode: '00952',
        claimFiling: 'MB',
        filingLimitDays: null,
        correctionMethod: null,
        appealDays: null,
        planType: null,
        isSearchable: false
      }
    );
  });

  it('keeps the filing limit, correction method, appeal window, plan type and searches', () => {
    assert.deepEqual(
      v.parse(payerSchema, {
        name: 'Blue',
        payerCode: 'BCBS1',
        claimFiling: 'BL',
        filingLimitDays: MAX_FILING_LIMIT_DAYS,
        correctionMethod: 'reopening',
        appealDays: MAX_APPEAL_DAYS,
        planType: 'government',
        isSearchable: true
      }),
      {
        name: 'Blue',
        payerCode: 'BCBS1',
        claimFiling: 'BL',
        filingLimitDays: MAX_FILING_LIMIT_DAYS,
        correctionMethod: 'reopening',
        appealDays: MAX_APPEAL_DAYS,
        planType: 'government',
        isSearchable: true
      }
    );
  });

  it('rejects blank and long names', () => {
    assert.deepEqual(issues({ name: '  ' }), ['Invalid length: Expected !0 but received 0']);
    assert.deepEqual(issues({ name: 'x'.repeat(61) }), [
      'Invalid length: Expected <=60 but received 61'
    ]);
  });

  it('needs a payer ID of 2 to 80 letters or digits', () => {
    for (const payerCode of ['0', '00-952', 'x'.repeat(81)]) {
      assert.deepEqual(
        issues({ payerCode }),
        ['A clearinghouse payer ID is 2 to 80 letters or digits'],
        payerCode
      );
    }
    assert.equal(v.parse(payerSchema, { ...BASE, payerCode: 'x'.repeat(80) }).payerCode.length, 80);
  });

  it('needs a known claim filing code', () => {
    assert.deepEqual(issues({ claimFiling: 'ZZ' }), [
      `Invalid type: Expected (${choices(CLAIM_FILING_CODES)}) but received "ZZ"`
    ]);
    assert.deepEqual(
      v.safeParse(payerSchema, { name: 'X', payerCode: '00952' }).issues?.map((i) => i.message),
      ['Invalid key: Expected "claimFiling" but received undefined']
    );
  });

  it('rejects filing limits that are not whole days in range', () => {
    assert.deepEqual(issues({ filingLimitDays: 0 }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues({ filingLimitDays: 1.5 }), ['Invalid integer: Received 1.5']);
    assert.deepEqual(issues({ filingLimitDays: MAX_FILING_LIMIT_DAYS + 1 }), [
      `Use at most ${MAX_FILING_LIMIT_DAYS} days`
    ]);
    assert.deepEqual(issues({ filingLimitDays: '90' }), [
      'Invalid type: Expected number but received "90"'
    ]);
  });

  it('rejects appeal windows that are not whole days in range', () => {
    assert.deepEqual(issues({ appealDays: 0 }), ['Invalid value: Expected >=1 but received 0']);
    assert.deepEqual(issues({ appealDays: MAX_APPEAL_DAYS + 1 }), [
      `Use at most ${MAX_APPEAL_DAYS} days`
    ]);
  });

  it('rejects unknown correction methods and plan types', () => {
    assert.deepEqual(issues({ correctionMethod: 'resubmit' }), [
      `Invalid type: Expected (${choices(CORRECTION_METHODS)}) but received "resubmit"`
    ]);
    assert.deepEqual(issues({ planType: 'hmo' }), [
      `Invalid type: Expected (${choices(PLAN_TYPES)}) but received "hmo"`
    ]);
  });
});

describe('searchPayersQuery', () => {
  it('trims the search text and pages by name ascending by default', () => {
    assert.deepEqual(v.parse(searchPayersQuery, { q: ' blue ' }), {
      q: 'blue',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
  });

  it('sorts by payer ID or filing code', () => {
    assert.deepEqual(
      v.parse(searchPayersQuery, { sort: 'payerCode', dir: 'desc', pageSize: '50' }),
      {
        page: 1,
        pageSize: 50,
        sort: 'payerCode',
        dir: 'desc'
      }
    );
    assert.equal(v.parse(searchPayersQuery, { sort: 'filing' }).sort, 'filing');
  });

  it('rejects unknown sorts, long searches and page sizes off the list', () => {
    for (const bad of [{ sort: 'updated' }, { q: 'x'.repeat(81) }, { pageSize: '1000' }]) {
      assert.equal(v.safeParse(searchPayersQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('listPayerNamesQuery', () => {
  it('takes optional trimmed search text up to 80 characters', () => {
    assert.deepEqual(v.parse(listPayerNamesQuery, {}), {});
    assert.deepEqual(v.parse(listPayerNamesQuery, { q: ' med ' }), { q: 'med' });
    assert.equal(v.safeParse(listPayerNamesQuery, { q: 'x'.repeat(81) }).success, false);
  });
});

describe('aliasParams', () => {
  it('needs the payer and learned name ids as UUIDs', () => {
    assert.deepEqual(v.parse(aliasParams, { id: ID, aliasId: ID }), { id: ID, aliasId: ID });
    assert.equal(v.safeParse(aliasParams, { id: ID, aliasId: 'a1' }).success, false);
    assert.equal(v.safeParse(aliasParams, { id: 'p1', aliasId: ID }).success, false);
  });
});
