import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { compileReport } from './testing.ts';
import { workQueueReport } from './work-queue-report.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('workQueueReport', () => {
  it('is an undated report grouped by queue or assignee', () => {
    assert.deepEqual(
      { dates: workQueueReport.dates, groups: workQueueReport.groups },
      { dates: null, groups: ['queue', 'assignee'] }
    );
  });

  it('counts open agency tasks by queue, aged in whole days from now', async () => {
    const { rows } = await compileReport(workQueueReport, 'queue');
    assert.equal(
      rows.sql,
      'select "r"."name" as "name", "r"."open" as "open", "r"."unassigned" as "unassigned", "r"."days_0_1" as "days_0_1", "r"."days_2_7" as "days_2_7", "r"."days_8_30" as "days_8_30", "r"."days_over_30" as "days_over_30", "r"."oldest_at" as "oldest_at", count(*) over () as "total" from (select t.queue as "name", count(*)::int as "open", (count(*) filter (where t.assignee_id is null))::int as "unassigned", (count(*) filter (where floor(extract(epoch from $1::timestamptz - t.created_at) / 86400) <= $2))::int as "days_0_1", (count(*) filter (where floor(extract(epoch from $3::timestamptz - t.created_at) / 86400) between $4 and $5))::int as "days_2_7", (count(*) filter (where floor(extract(epoch from $6::timestamptz - t.created_at) / 86400) between $7 and $8))::int as "days_8_30", (count(*) filter (where floor(extract(epoch from $9::timestamptz - t.created_at) / 86400) >= $10))::int as "days_over_30", min(t.created_at) as "oldest_at" from "tasks" as "t" left join "users" as "u" on "u"."id" = "t"."assignee_id" where "t"."agency_id" = $11 and "t"."status" = $12 group by 1) as "r" order by "r"."open" desc nulls last, "r"."name" desc limit $13 offset $14'
    );
    assert.deepEqual(rows.parameters, [
      '2026-10-23T15:00:00.000Z',
      1,
      '2026-10-23T15:00:00.000Z',
      2,
      7,
      '2026-10-23T15:00:00.000Z',
      8,
      30,
      '2026-10-23T15:00:00.000Z',
      31,
      't-1',
      'open',
      100,
      0
    ]);
  });

  it('names each row by the assignee email when grouped by assignee', async () => {
    const byQueue = await compileReport(workQueueReport, 'queue');
    const byAssignee = await compileReport(workQueueReport, 'assignee');
    assert.equal(
      byAssignee.rows.sql,
      byQueue.rows.sql.replace('t.queue as "name"', 'u.email as "name"')
    );
    assert.notEqual(byAssignee.rows.sql, byQueue.rows.sql);
  });

  it('totals the open, unassigned and aged counts', async () => {
    const { rows, totals } = await compileReport(workQueueReport, 'queue');
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."open"), 0)::float8 as "open", coalesce(sum("r"."unassigned"), 0)::float8 as "unassigned", coalesce(sum("r"."days_0_1"), 0)::float8 as "days_0_1", coalesce(sum("r"."days_2_7"), 0)::float8 as "days_2_7", coalesce(sum("r"."days_8_30"), 0)::float8 as "days_8_30", coalesce(sum("r"."days_over_30"), 0)::float8 as "days_over_30"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
