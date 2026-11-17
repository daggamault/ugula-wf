import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { importsReport } from './imports-report.ts';
import { compileReport } from './testing.ts';

const subquery = (sql: string) =>
  sql.slice(sql.indexOf(' from (select'), sql.lastIndexOf(') as "r"') + 8);

describe('importsReport', () => {
  it('is an ungrouped report over received dates', () => {
    assert.deepEqual(
      { dates: importsReport.dates, groups: importsReport.groups },
      { dates: 'received', groups: null }
    );
  });

  it('lists agency imports received in the period, oldest first', async () => {
    const { rows } = await compileReport(importsReport);
    assert.ok(
      rows.sql.endsWith(
        'where "i"."agency_id" = $1 and "i"."created_at" >= ($2::date)::timestamp at time zone $3 and "i"."created_at" < ($4::date + 1)::timestamp at time zone $5) as "r" order by "r"."received_at" asc nulls last, "r"."id" asc limit $6 offset $7'
      )
    );
    assert.deepEqual(rows.parameters, [
      't-1',
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York',
      100,
      0
    ]);
  });

  it('counts PCRs by claim outcome, telling revisions apart from PCRs that never got a claim', async () => {
    const { rows } = await compileReport(importsReport);
    assert.equal(
      rows.sql,
      `select "r"."id" as "id", "r"."received_at" as "received_at", "r"."file_name" as "file_name", "r"."source" as "source", "r"."pcrs" as "pcrs", "r"."billed" as "billed", "r"."drafts" as "drafts", "r"."voided" as "voided", "r"."revisions" as "revisions", "r"."no_claim" as "no_claim", "r"."failed" as "failed", "r"."charges_cents" as "charges_cents", count(*) over () as "total" from (select "i"."id", "i"."created_at" as "received_at", "i"."file_name", "i"."source", coalesce(i.report_count, x.pcrs) as "pcrs", "x"."billed", "x"."drafts", "x"."voided", "x"."revisions", "x"."no_claim", "runs"."failed", "x"."charges" as "charges_cents" from "imports" as "i" inner join lateral (select count(*)::int as "pcrs", (count(*) filter (where c.status not in ('draft', 'void')))::int as "billed", (count(*) filter (where c.status = 'draft'))::int as "drafts", (count(*) filter (where c.status = 'void'))::int as "voided", (count(*) filter (where c.id is null and exists (select 1 from claims o where o.agency_id = i.agency_id and o.pcr_number = ir.pcr_number)))::int as "revisions", (count(*) filter (where c.id is null and not exists (select 1 from claims o where o.agency_id = i.agency_id and o.pcr_number = ir.pcr_number)))::int as "no_claim", coalesce(sum("c"."total_cents") filter (where c.status not in ('draft', 'void')), 0)::float8 as "charges" from "import_reports" as "ir" left join "claims" as "c" on "c"."import_report_id" = "ir"."id" where "ir"."import_id" = "i"."id") as "x" on true inner join lateral (select (count(*) filter (where ch.status in ('faulted', 'failed')))::int as "failed" from "workflow_runs" as "ch" where "ch"."parent_id" = "i"."run_id") as "runs" on true where "i"."agency_id" = $1 and "i"."created_at" >= ($2::date)::timestamp at time zone $3 and "i"."created_at" < ($4::date + 1)::timestamp at time zone $5) as "r" order by "r"."received_at" asc nulls last, "r"."id" asc limit $6 offset $7`
    );
  });

  it('totals every count and the charges', async () => {
    const { rows, totals } = await compileReport(importsReport);
    assert.equal(
      totals.sql.replace(subquery(rows.sql), ''),
      'select coalesce(sum("r"."pcrs"), 0)::float8 as "pcrs", coalesce(sum("r"."billed"), 0)::float8 as "billed", coalesce(sum("r"."drafts"), 0)::float8 as "drafts", coalesce(sum("r"."voided"), 0)::float8 as "voided", coalesce(sum("r"."revisions"), 0)::float8 as "revisions", coalesce(sum("r"."no_claim"), 0)::float8 as "no_claim", coalesce(sum("r"."failed"), 0)::float8 as "failed", coalesce(sum("r"."charges_cents"), 0)::float8 as "charges_cents"'
    );
    assert.deepEqual(totals.parameters, rows.parameters.slice(0, -2));
  });
});
