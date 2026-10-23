import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import {
  AGING_BUCKETS,
  agingReport,
  hcpcsReport,
  monthlyReport,
  patientPayments,
  payerReport
} from './queries.ts';

const range = { from: '2026-01-01', to: '2026-10-23' };

const compile = async (
  run: (db: ReturnType<typeof createRecordingDb>['db']) => Promise<unknown>
) => {
  const { db, queries } = createRecordingDb(() => [{ paid_cents: 0, adjusted_cents: 0 }]);
  await run(db);
  const [q] = queries;
  assert.ok(q);
  return q;
};

describe('report queries', () => {
  it('ages open balances by the payer still owing, or the patient, as of a day', async () => {
    const q = await compile((db) => agingReport(db, 't-1', '2026-10-23'));
    assert.ok(
      q.sql.includes('left join lateral (select coalesce(dp.name, cc.payer_name) as "payer"')
    );
    assert.ok(
      q.sql.includes(
        'not exists (select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id" and "e"."kind" in ($15, $16))'
      )
    );
    assert.ok(q.sql.includes('order by "cc"."position" limit $17) as "responsible" on true'));
    assert.ok(
      q.sql.includes('($1::date - coalesce(c.service_date, c.created_at::date)) between $2 and $3')
    );
    assert.ok(q.sql.includes('group by responsible.payer'));
    assert.equal(AGING_BUCKETS.length, 5);
    assert.deepEqual(q.parameters.slice(0, 3), ['2026-10-23', 0, 30]);
    assert.deepEqual(q.parameters.slice(-6), ['response', 'payer_skipped', 1, 't-1', 'open', 0]);
  });

  it('summarizes charges, payments and balances by month of service', async () => {
    const q = await compile((db) => monthlyReport(db, 't-1', range));
    assert.ok(
      q.sql.includes(
        "to_char(date_trunc('month', coalesce(c.service_date, c.created_at::date)), 'YYYY-MM') as \"month\""
      )
    );
    assert.ok(q.sql.includes("filter (where c.status = 'open')"));
    assert.ok(q.sql.includes('between $2::date and $3::date'));
    assert.ok(q.sql.endsWith('group by 1 order by "month" desc'));
    assert.deepEqual(q.parameters, ['t-1', '2026-01-01', '2026-10-23']);
  });

  it('totals charge lines by HCPCS code', async () => {
    const q = await compile((db) => hcpcsReport(db, 't-1', range));
    assert.ok(q.sql.includes('from "claim_lines" as "l" inner join "claims" as "c"'));
    assert.ok(q.sql.includes('count(distinct l.claim_id)::int as "claims"'));
    assert.ok(q.sql.endsWith('group by "l"."code" order by "charges_cents" desc'));
  });

  it('measures each payer by claims billed, answered, paid and days to respond', async () => {
    const q = await compile((db) => payerReport(db, 't-1', range));
    assert.ok(q.sql.includes('"e"."coverage_id" = "cc"."id"'));
    assert.ok(q.sql.includes('bool_and(cc.payer_id is not null) as "in_directory"'));
    assert.ok(q.sql.includes('activity.first_response > activity.first_submitted'));
    assert.ok(q.sql.endsWith('group by 1 order by "paid_cents" desc'));
  });

  it('totals patient payments, which have no coverage', async () => {
    const q = await compile((db) => patientPayments(db, 't-1', range));
    assert.ok(q.sql.includes('"e"."coverage_id" is null'));
    assert.deepEqual(q.parameters.slice(0, 2), ['t-1', 'response']);
  });
});
