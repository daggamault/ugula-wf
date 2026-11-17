import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { activityReport } from './activity-report.ts';
import { compileReport } from './testing.ts';

const aliases = (sql: string) =>
  [...sql.slice(0, sql.indexOf(' from (')).matchAll(/ as "(\w+)"/g)].map((m) => m[1]);

const tail = (sql: string) => sql.slice(sql.lastIndexOf(') as "r"'));

const WITHIN = (n: number) =>
  `"e"."created_at" >= ($${n}::date)::timestamp at time zone $${n + 1} and "e"."created_at" < ($${n + 2}::date + 1)::timestamp at time zone $${n + 3}`;

const PARAMETERS = [
  ...['America/New_York', 't-1', 'submitted', 'resubmitted'],
  ...['2026-01-01', 'America/New_York', '2026-10-23', 'America/New_York'],
  ...['submitted', 'resubmitted'],
  ...['America/New_York', 't-1', 'response', 'refunded', 'balance_protected'],
  ...['2026-01-01', 'America/New_York', '2026-10-23', 'America/New_York'],
  ...['America/New_York', 't-1', 'closed', 'written_off', 'collections'],
  ...['2026-01-01', 'America/New_York', '2026-10-23', 'America/New_York']
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
      ') as "r" order by "r"."month" asc nulls last, "r"."month" asc limit $29 offset $30'
    );
    assert.deepEqual(aliases(totals.sql), amounts);
    assert.deepEqual(rows.parameters, [...PARAMETERS, 100, 0]);
    assert.deepEqual(totals.parameters, PARAMETERS);
  });

  it('buckets each part by the month of the event in the agency time zone', async () => {
    const { rows } = await compileReport(activityReport);
    assert.equal(rows.sql.match(/union all/g)?.length, 2);
    for (const n of [1, 11, 20]) {
      assert.ok(
        rows.sql.includes(`to_char("e"."created_at" at time zone $${n}, 'YYYY-MM') as "month"`)
      );
    }
    assert.ok(
      rows.sql.endsWith(
        ') as "f" group by "f"."month") as "r" order by "r"."month" asc nulls last, "r"."month" asc limit $29 offset $30'
      )
    );
  });

  it('bills a claim once, on its first submission in the period', async () => {
    const { rows } = await compileReport(activityReport);
    assert.ok(
      rows.sql.includes(
        `where "e"."agency_id" = $2 and "e"."kind" in ($3, $4) and ${WITHIN(5)} and not exists (select "f"."id" from "claim_events" as "f" where "f"."claim_id" = "e"."claim_id" and "f"."kind" in ($9, $10) and (f.created_at, f.id) < (e.created_at, e.id))`
      )
    );
    assert.ok(rows.sql.includes('1 as "claims_billed", c.total_cents as "charges_billed"'));
  });

  it('splits posted payments between payers and the patient and books refunds and balance protections', async () => {
    const { rows } = await compileReport(activityReport);
    assert.ok(
      rows.sql.includes(
        `where "e"."agency_id" = $12 and "e"."kind" in ($13, $14, $15) and ${WITHIN(16)}`
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
        `inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id" where "e"."agency_id" = $21 and "e"."kind" = $22 and "e"."note" in ($23, $24) and ${WITHIN(25)}`
      )
    );
    assert.ok(
      rows.sql.includes(
        `case when e.note = 'written_off' then b.balance_cents else 0 end as "written_off", case when e.note = 'collections' then b.balance_cents else 0 end as "collections"`
      )
    );
  });
});
