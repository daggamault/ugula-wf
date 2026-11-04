import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findReport, REPORTS, type ReportContext } from './queries.ts';

const ctx: ReportContext = {
  agencyId: 't-1',
  tz: 'America/New_York',
  now: '2026-10-23T15:00:00.000Z',
  today: '2026-10-23',
  range: { from: '2026-01-01', to: '2026-10-23' },
  group: ''
};

const compile = async (id: string, group = '', page: number | 'all' = 1) => {
  const { db, queries } = createRecordingDb(() => [{ total: '1', paid_cents: 5 }]);
  const report = findReport(id);
  assert.ok(report);
  const result = await report.run(db, { ...ctx, group }, page);
  const [rows, totals] = queries;
  assert.ok(rows && totals);
  return { result, rows, totals };
};

describe('report queries', () => {
  it('runs every report and every part of a combined report for the agency only', async () => {
    const scoped = (sql: string) => sql.match(/"agency_id" = \$\d+/g)?.length ?? 0;
    const parts = (sql: string) => (sql.match(/union all/g)?.length ?? 0) + 1;
    for (const [id, report] of Object.entries(REPORTS)) {
      for (const group of report.groups ?? ['']) {
        const { rows, totals } = await compile(id, group);
        for (const q of [rows, totals]) {
          assert.equal(scoped(q.sql), parts(q.sql), `${id} ${group}`);
          assert.equal(
            q.parameters.filter((p) => p === 't-1').length,
            parts(q.sql),
            `${id} ${group}`
          );
        }
      }
    }
  });

  it('pages 100 rows at a time and returns totals across every page', async () => {
    const { result, rows, totals } = await compile('payments', '', 2);
    assert.ok(rows.sql.includes('count(*) over () as "total"'));
    assert.deepEqual(rows.parameters.slice(-2), [100, 100]);
    assert.ok(totals.sql.startsWith('select coalesce(sum("r"."paid_cents"), 0)::float8'));
    assert.deepEqual(result.totals, { total: '1', paid_cents: 5 });
    assert.equal(result.total, 1);
  });

  it('returns every row in one page when exporting', async () => {
    const { result, rows } = await compile('hcpcs', '', 'all');
    assert.ok(!rows.sql.includes('limit') && !rows.sql.includes('count(*) over ()'));
    assert.ok(rows.sql.endsWith('order by "r"."charges_cents" desc nulls last, "r"."code" desc'));
    assert.deepEqual(result.pageSize, 1);
  });

  it('ages open balances from the date of service by who owes them now', async () => {
    const { rows } = await compile('aging', 'payer');
    assert.ok(rows.sql.includes('as "responsible" on true'));
    assert.ok(rows.sql.includes('($1::date - coalesce(c.service_date, c.created_at::date)) <= $2'));
    assert.ok(rows.sql.includes('responsible.payer as "name"'));
    const byClass = await compile('aging', 'class');
    assert.ok(byClass.rows.sql.includes("coalesce(responsible.filing, '')"));
    assert.deepEqual(rows.parameters.slice(0, 2), ['2026-10-23', 30]);
  });

  it('filters service dates on the indexed column and posting dates in the time zone', async () => {
    const monthly = await compile('monthly');
    assert.ok(monthly.rows.sql.includes('c.service_date between $'));
    assert.ok(!monthly.rows.sql.includes('coalesce(c.service_date'));
    const payments = await compile('payments');
    assert.ok(
      payments.rows.sql.includes(
        '"e"."created_at" >= ($4::date)::timestamp at time zone $5 and "e"."created_at" < ($6::date + 1)::timestamp at time zone $7'
      )
    );
    assert.deepEqual(payments.rows.parameters.slice(0, 7), [
      't-1',
      'response',
      'refunded',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York'
    ]);
  });

  it('adds the patient to payer performance and counts only billed coverages', async () => {
    const { rows } = await compile('payers', 'payer');
    assert.ok(rows.sql.includes('union all'));
    assert.ok(rows.sql.includes('a.first_submitted is not null or a.responses > 0'));
    assert.ok(rows.sql.includes('"e"."coverage_id" is null'));
    assert.ok(
      rows.sql.includes('e.paid_cents = 0 and exists (select 1 from claim_event_adjustments a')
    );
  });

  it('posts payments and refunds with their paid date, check number and reason codes', async () => {
    const { rows } = await compile('payments');
    for (const column of ['"e"."paid_on"', '"e"."check_number"', '"e"."payer_claim_number"']) {
      assert.ok(rows.sql.includes(column), column);
    }
    assert.ok(rows.sql.includes("a.group_code || '-' || a.reason_code"));
  });

  it('sums reason codes by payer and code, or by code alone', async () => {
    const byPayer = await compile('denials', 'payer');
    assert.ok(byPayer.rows.sql.includes('from "claim_event_adjustments" as "a"'));
    assert.ok(byPayer.rows.sql.includes('group by 1, 2'));
    assert.ok(byPayer.rows.sql.includes('coalesce(dp.name, cc.payer_name)'));
    const byReason = await compile('denials', 'reason');
    assert.ok(byReason.rows.sql.includes('null as "payer"'));
    assert.ok(byReason.totals.sql.includes('"r"."amount_cents"'));
  });

  it('books monthly activity from first submissions, payments and closings', async () => {
    const { rows } = await compile('activity');
    assert.ok(rows.sql.includes('(f.created_at, f.id) < (e.created_at, e.id)'));
    assert.equal(rows.sql.match(/union all/g)?.length, 2);
    assert.ok(rows.sql.includes('group by "f"."month"'));
  });

  it('lists write-offs and collections by the day they closed', async () => {
    const { rows } = await compile('write-offs');
    assert.ok(rows.parameters.includes('written_off') && rows.parameters.includes('collections'));
    assert.ok(rows.sql.includes('"e"."note" in ('));
  });

  it('groups open tasks by queue or assignee and ages them from now', async () => {
    const byQueue = await compile('work-queue', 'queue');
    assert.ok(byQueue.rows.sql.includes('t.queue as "name"'));
    assert.ok(byQueue.rows.parameters.includes('2026-10-23T15:00:00.000Z'));
    const byAssignee = await compile('work-queue', 'assignee');
    assert.ok(byAssignee.rows.sql.includes('u.email as "name"'));
  });

  it('counts revisions apart from PCRs that never got a claim', async () => {
    const { rows } = await compile('imports');
    assert.ok(rows.sql.includes('c.id is null and exists'));
    assert.ok(rows.sql.includes('c.id is null and not exists'));
    assert.ok(rows.sql.includes('o.agency_id = i.agency_id and o.pcr_number = ir.pcr_number'));
    assert.ok(rows.sql.includes('"ch"."parent_id" = "i"."run_id"'));
  });

  it('ages claims not yet submitted from their service day with their oldest open task', async () => {
    const { rows } = await compile('unbilled');
    assert.ok(rows.sql.includes('"t"."status" = $'));
    assert.ok(rows.sql.includes('order by "t"."created_at" limit $'));
    assert.ok(rows.sql.includes('order by "r"."age_days" desc nulls last'));
    for (const status of ['draft', 'needs_review', 'ready']) {
      assert.ok(rows.parameters.includes(status), status);
    }
    assert.ok(!rows.parameters.includes('submitted'));
  });

  it('sums trips, miles and charges by level and emergency, leaving drafts and voids out', async () => {
    const { rows, totals } = await compile('levels');
    assert.ok(rows.sql.includes('group by "c"."level", "c"."emergency"'));
    assert.ok(rows.parameters.includes('draft') && rows.parameters.includes('void'));
    assert.ok(totals.sql.includes('"r"."miles"'));
  });

  it('credits completed tasks, submissions and postings to the user who did them', async () => {
    const { rows } = await compile('productivity');
    assert.ok(rows.sql.includes('"t"."completed_by" is not null'));
    assert.ok(rows.sql.includes('"e"."created_by" is not null'));
    assert.ok(rows.sql.includes('inner join "users" as "u" on "u"."id" = "f"."user_id"'));
    assert.ok(rows.sql.includes('"t"."completed_at" >= ('));
    assert.ok(rows.sql.includes('group by "u"."email"'));
  });

  it('finds reports by id only', () => {
    assert.ok(findReport('aging'));
    assert.equal(findReport('toString'), undefined);
  });
});
