import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createAccountingStore } from './queries.ts';

const DEPOSIT = '0195f2a4-0000-7000-8000-0000000000d1';

const FILE = '0195f2a4-0000-7000-8000-0000000000f1';

const USER = '0195f2a4-0000-7000-8000-0000000000e1';

describe('createAccountingStore', () => {
  it('reads unmatched deposits and 835s of the agency that share a trace number', async () => {
    const pair = { depositId: DEPOSIT, payerFileId: FILE, depositTrace: 'EFT1' };
    const { db, queries } = createRecordingDb(() => [pair]);
    const store = createAccountingStore(db);
    assert.deepEqual(await store.depositPairs('r1', { depositId: DEPOSIT, payerFileId: null }), [
      pair
    ]);
    assert.equal(
      queries[0]?.sql,
      'select "d"."id" as "depositId", "f"."id" as "payerFileId", "d"."trace_number" as "depositTrace", "d"."amount_cents" as "depositCents", f.trace_number as "remittanceTrace", f.payment_cents as "remittanceCents", "d"."payer_name" as "payerName", "f"."file_name" as "fileName" from "deposits" as "d" inner join "payer_files" as "f" on "f"."agency_id" = "d"."agency_id" and "f"."trace_number" = "d"."trace_number" where "d"."agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1) and "d"."payer_file_id" is null and "f"."kind" = $2 and "f"."payment_cents" is not null and not exists (select "m"."id" from "deposits" as "m" where "m"."payer_file_id" = "f"."id") and "d"."id" = $3 order by "d"."deposited_on", "f"."created_at"'
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', '835', DEPOSIT]);
    assert.deepEqual(await store.depositPairs('r1', { depositId: 'nope', payerFileId: null }), []);
    assert.equal(queries.length, 1);
  });

  it('matches a deposit only while neither side is matched', async () => {
    const { db, queries } = createRecordingDb();
    await createAccountingStore(db).matchDeposit('r1', DEPOSIT, FILE);
    assert.equal(
      queries[0]?.sql,
      'update "deposits" set "payer_file_id" = $1 where "id" = $2 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $3) and "payer_file_id" is null and not exists (select "m"."id" from "deposits" as "m" where "m"."payer_file_id" = $4)'
    );
    assert.deepEqual(queries[0]?.parameters, [FILE, DEPOSIT, 'r1', FILE]);
    await assert.rejects(() => createAccountingStore(db).matchDeposit('r1', 'x', FILE), {
      message: `Deposit x or file ${FILE} does not exist`
    });
  });

  it('reads unmatched deposits and paying 835s not reported yet', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        deposits: [
          {
            deposit_id: DEPOSIT,
            payer_file_id: null,
            trace_number: 'EFT1',
            amount_cents: 1000,
            received_on: '2026-11-01',
            payer_name: 'Medicare'
          }
        ],
        remittances: [
          {
            deposit_id: null,
            payer_file_id: FILE,
            trace_number: 'EFT2',
            amount_cents: 500,
            received_on: '2026-11-02',
            payer_name: null
          }
        ]
      }
    ]);
    assert.deepEqual(await createAccountingStore(db).unmatchedPayments('r1', '2026-11-14'), {
      deposits: [
        {
          kind: 'deposit',
          depositId: DEPOSIT,
          payerFileId: null,
          traceNumber: 'EFT1',
          amountCents: 1000,
          receivedOn: '2026-11-01',
          payerName: 'Medicare'
        }
      ],
      remittances: [
        {
          kind: 'remittance',
          depositId: null,
          payerFileId: FILE,
          traceNumber: 'EFT2',
          amountCents: 500,
          receivedOn: '2026-11-02',
          payerName: null
        }
      ]
    });
    const sql = queries[0]?.sql ?? '';
    assert.match(sql, /d\.payer_file_id is null and d\.deposited_on <= \$\d+::date/);
    assert.match(sql, /f\.kind = '835' and f\.trace_number is not null and f\.payment_cents > 0/);
    assert.match(sql, /r\.inputs ->> \$\d+ = "d"\."id"::text/);
    assert.match(sql, /from open_deposits x\) as deposits/);
    assert.match(sql, /not exists \(select 1 from deposits m where m\.payer_file_id = f\.id\)/);
    assert.deepEqual(queries[0]?.parameters, [
      'r1',
      '2026-11-14',
      'billing.unmatched-payment',
      'depositId',
      '2026-11-14',
      'billing.unmatched-payment',
      'payerFileId'
    ]);
  });

  it('totals a month by posting date', async () => {
    const { db, queries } = createRecordingDb(() => [
      { charges: 100, payments: 80, refunds: 5, adjustments: 10, write_offs: 3 }
    ]);
    assert.deepEqual(await createAccountingStore(db).periodTotals('r1', '2026-10-01'), {
      chargesCents: 100,
      paymentsCents: 80,
      refundsCents: 5,
      adjustmentsCents: 10,
      writeOffsCents: 3
    });
    assert.match(
      queries[0]?.sql ?? '',
      /e\.posted_on >= \$\d+::date and e\.posted_on < \(\$\d+::date \+ interval '1 month'\)/
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', '2026-10-01', '2026-10-01']);
  });

  it('closes a month once and emits Period Closed only when it closed it', async () => {
    let inserted = true;
    const { db, queries } = createRecordingDb(({ sql }) => {
      if (sql.startsWith('select "agency_id"')) return [{ agency_id: 't1' }];
      if (sql.startsWith('insert into "accounting_periods"'))
        return inserted ? [{ period_on: '2026-10-01' }] : [];
      if (sql.startsWith('insert into "events"')) return [{ id: 'e1' }];
      return [];
    });
    const store = createAccountingStore(db);
    await store.closePeriod('r1', '2026-10-01', USER);
    const writes = () =>
      queries
        .filter((q) => q.sql.startsWith('insert'))
        .map((q) => [q.sql.split(' (')[0], q.parameters]);
    assert.deepEqual(writes(), [
      ['insert into "accounting_periods"', ['t1', '2026-10-01', USER]],
      ['insert into "events"', ['t1', 'period.closed', '{"period":"2026-10-01"}', null]]
    ]);
    inserted = false;
    await store.closePeriod('r1', '2026-10-01', 'not-a-user');
    assert.deepEqual(writes().slice(2), [
      ['insert into "accounting_periods"', ['t1', '2026-10-01', null]]
    ]);
  });
});
