import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { depositSchema, searchDepositsQuery } from './schemas.ts';

const issues = (input: unknown) =>
  v.safeParse(depositSchema, input).issues?.map((i) => i.message.split(':')[0]);

describe('depositSchema', () => {
  it('trims the trace number and clears blank optional text', () => {
    assert.deepEqual(
      v.parse(depositSchema, {
        traceNumber: ' EFT1 ',
        amountCents: 1000,
        depositedOn: '2026-11-02',
        payerName: ' ',
        note: ' Lockbox '
      }),
      {
        traceNumber: 'EFT1',
        amountCents: 1000,
        depositedOn: '2026-11-02',
        payerName: null,
        note: 'Lockbox'
      }
    );
  });

  it('refuses a missing trace number, an amount that is not whole positive cents and a bad date', () => {
    assert.ok(issues({ traceNumber: ' ', amountCents: 1, depositedOn: '2026-11-02' })?.length);
    assert.ok(issues({ traceNumber: 'T', amountCents: 0, depositedOn: '2026-11-02' })?.length);
    assert.ok(issues({ traceNumber: 'T', amountCents: 1.5, depositedOn: '2026-11-02' })?.length);
    assert.deepEqual(issues({ traceNumber: 'T', amountCents: 1, depositedOn: 'soon' }), [
      'Use a date like 2026-11-02'
    ]);
  });
});

describe('searchDepositsQuery', () => {
  it('pages the latest deposits first and sorts by amount or trace', () => {
    assert.deepEqual(v.parse(searchDepositsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'deposited',
      dir: 'desc'
    });
    assert.equal(v.parse(searchDepositsQuery, { sort: 'trace' }).sort, 'trace');
    assert.equal(v.safeParse(searchDepositsQuery, { sort: 'payer' }).success, false);
  });
});
