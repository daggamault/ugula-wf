import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityReport } from './activity-report.ts';
import { compileReport } from './testing.ts';

const aliases = (sql: string) =>
  [...sql.slice(0, sql.indexOf(' from (')).matchAll(/ as "(\w+)"/g)].map((m) => m[1]);

const tail = (sql: string) => sql.slice(sql.lastIndexOf(') as "r"'));

const WITHIN = (n: number) => `e.posted_on between $${n}::date and $${n + 1}::date`;

const PARAMETERS = [
  ...['t-1', 'submitted', 'resubmitted', '2026-01-01', '2026-10-23', 'submitted', 'resubmitted'],
  ...['t-1', 'response', 'refunded', 'balance_protected', '2026-01-01', '2026-10-23'],
  ...['t-1', 'closed', 'written_off', 'collections', '2026-01-01', '2026-10-23']
];

describe('activityReport', () => {
  it('is an ungrouped report over posting dates', () => {
    assert.deepEqual(
      { dates: activityReport.dates, groups: activityReport.groups },
      { dates: 'posted', groups: null }
    );
  });

  it('lists months oldest first with every amount summed in the totals', async () => {
    const { rows, totals } = await compileReport(activityReport);
    const amounts = [
      'claims_billed',
      'charges_billed_cents',
      'payer_paid_cents',
      'patient_paid_cents',
      'adjusted_cents',
      'refunds_cents',
      'written_off_cents',
      'collections_cents'
    ];
    assert.deepEqual(aliases(rows.sql), ['month', ...amounts, 'total']);
    assert.equal(
      tail(rows.sql),
      ') as "r" order by "r"."month" asc nulls last, "r"."month" asc limit $20 offset $21'
    );
    assert.deepEqual(aliases(totals.sql), amounts);
    assert.deepEqual(rows.parameters, [...PARAMETERS, 100, 0]);
    assert.deepEqual(totals.parameters, PARAMETERS);
  });

  it('buckets each part by the month it was posted to', async () => {
    const { rows } = await compileReport(activityReport);
    assert.equal(rows.sql.match(/union all/g)?.length, 2);
    assert.equal(rows.sql.match(/to_char\(e\.posted_on, 'YYYY-MM'\) as "month"/g)?.length, 3);
    assert.ok(
      rows.sql.endsWith(
        ') as "f" group by "f"."month") as "r" order by "r"."month" asc nulls last, "r"."month" asc limit $20 offset $21'
      )
    );
  });

  it('bills a claim once, on its first submission in the period', async () => {
    const { rows } = await compileReport(activityReport);
    assert.ok(
      rows.sql.includes(
        `where "e"."agency_id" = $1 and "e"."kind" in ($2, $3) and ${WITHIN(4)} and not exists (select "f"."id" from "claim_events" as "f" where "f"."claim_id" = "e"."claim_id" and "f"."kind" in ($6, $7) and (f.created_at, f.id) < (e.created_at, e.id))`
      )
    );
    assert.ok(rows.sql.includes('1 as "claims_billed", c.total_cents as "charges_billed"'));
  });

  it('splits posted payments between payers and the patient and books refunds and balance protections', async () => {
    const { rows } = await compileReport(activityReport);
    assert.ok(
      rows.sql.includes(
        `where "e"."agency_id" = $8 and "e"."kind" in ($9, $10, $11) and ${WITHIN(12)}`
      )
    );
    assert.ok(
      rows.sql.includes(
        `case when e.kind = 'response' and e.coverage_id is not null then e.paid_cents else 0 end as "payer_paid", case when e.kind = 'response' and e.coverage_id is null then e.paid_cents else 0 end as "patient_paid", e.adjusted_cents as "adjusted", case when e.kind = 'refunded' then -e.paid_cents else 0 end as "refunds"`
      )
    );
  });

  it('books the remaining balance of claims closed to write-off or collections', async () => {
    const { rows } = await compileReport(activityReport);
    assert.ok(
      rows.sql.includes(
        `inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id" where "e"."agency_id" = $14 and "e"."kind" = $15 and "e"."note" in ($16, $17) and ${WITHIN(18)}`
      )
    );
    assert.ok(
      rows.sql.includes(
        `case when e.note = 'written_off' then b.balance_cents else 0 end as "written_off", case when e.note = 'collections' then b.balance_cents else 0 end as "collections"`
      )
    );
  });
});
