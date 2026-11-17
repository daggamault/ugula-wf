import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { productivityReport } from './productivity-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('productivityReport', () => {
  it('is an ungrouped report over completion dates', () => {
    assert.deepEqual(
      { dates: productivityReport.dates, groups: productivityReport.groups },
      { dates: 'completed', groups: null }
    );
  });

  it('credits completed tasks and payments posted in the period to the user who did them', async () => {
    const { rows } = await compileReport(productivityReport);
    assert.equal(
      rows.sql,
      `select "r"."name" as "name", "r"."tasks" as "tasks", "r"."task_hours" as "task_hours", "r"."posted" as "posted", count(*) over () as "total" from (select "u"."email" as "name", coalesce(sum("f"."tasks"), 0)::float8 as "tasks", coalesce(sum("f"."task_hours"), 0)::float8 as "task_hours", coalesce(sum("f"."posted"), 0)::float8 as "posted" from (select t.completed_by_id as "user_id", 1 as "tasks", extract(epoch from t.completed_at - t.created_at) / 3600 as "task_hours", 0 as "posted" from "tasks" as "t" where "t"."agency_id" = $1 and "t"."status" = $2 and "t"."completed_by_id" is not null and "t"."completed_at" >= ($3::date)::timestamp at time zone $4 and "t"."completed_at" < ($5::date + 1)::timestamp at time zone $6 union all select e.created_by_id as "user_id", 0 as "tasks", 0 as "task_hours", 1 as "posted" from "claim_events" as "e" where "e"."agency_id" = $7 and "e"."kind" = $8 and "e"."created_by_id" is not null and "e"."created_at" >= ($9::date)::timestamp at time zone $10 and "e"."created_at" < ($11::date + 1)::timestamp at time zone $12) as "f" inner join "users" as "u" on "u"."id" = "f"."user_id" group by "u"."email") as "r" order by "r"."tasks" desc nulls last, "r"."name" desc limit $13 offset $14`
    );
    assert.deepEqual(rows.parameters, [
      't-1',
      'completed',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      't-1',
      'response',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      100,
      0
    ]);
  });

  it('totals tasks, hours and postings', async () => {
    const { rows, totals } = await compileReport(productivityReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."tasks"), 0)::float8 as "tasks", coalesce(sum("r"."task_hours"), 0)::float8 as "task_hours", coalesce(sum("r"."posted"), 0)::float8 as "posted"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
