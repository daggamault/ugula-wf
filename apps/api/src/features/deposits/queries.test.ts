import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findDeposit, insertDeposit, searchDeposits } from './queries.ts';

const SELECT =
  'select "d"."id", "d"."trace_number", "d"."amount_cents", "d"."deposited_on", "d"."payer_name", "d"."note", "d"."payer_file_id", "f"."file_name", "f"."payment_cents", "f"."paid_on", "u"."email" as "created_by", "d"."created_at"';

const FROM =
  'from "deposits" as "d" left join "payer_files" as "f" on "f"."id" = "d"."payer_file_id" left join "users" as "u" on "u"."id" = "d"."created_by_id" where "d"."agency_id" = $1';

describe('deposit queries', () => {
  it('searches agency deposits by trace number or payer, with their matched 835', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'd1', total: '1' }]);
    const page = await searchDeposits(db, 't-1', {
      q: 'Eft',
      page: 1,
      pageSize: 25,
      sort: 'amount',
      dir: 'desc'
    });
    assert.deepEqual(page, { items: [{ id: 'd1' }], total: 1, page: 1, pageSize: 25 });
    assert.equal(
      queries[0]?.sql,
      `${SELECT}, count(*) over () as "total" ${FROM} and (lower(d.trace_number) like $2 or lower(d.payer_name) like $3) order by "d"."amount_cents" desc nulls last, "d"."id" desc limit $4 offset $5`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%eft%', '%eft%', 25, 0]);
  });

  it('finds one deposit within the agency', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findDeposit(db, 't-1', 'd1'), undefined);
    assert.equal(queries[0]?.sql, `${SELECT} ${FROM} and "d"."id" = $2`);
  });

  it('records a deposit once per trace number', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'd1' }]);
    assert.deepEqual(
      await insertDeposit(db, 't-1', 'u-1', {
        traceNumber: 'EFT1',
        amountCents: 1000,
        depositedOn: '2026-11-02',
        payerName: null,
        note: null
      }),
      { id: 'd1' }
    );
    assert.equal(
      queries[0]?.sql,
      'insert into "deposits" ("agency_id", "trace_number", "amount_cents", "deposited_on", "payer_name", "note", "created_by_id") values ($1, $2, $3, $4, $5, $6, $7) on conflict ("agency_id", "trace_number") do nothing returning "id"'
    );
  });
});
