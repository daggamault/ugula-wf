import { sql } from 'kysely';
import { report } from './report.ts';
import { centsWhere, count, countWhere, within } from './report-sql.ts';

export const importsReport = report({
  dates: 'received',
  rows: (db, ctx) =>
    db
      .selectFrom('imports as i')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('import_reports as ir')
            .leftJoin('claims as c', 'c.import_report_id', 'ir.id')
            .select([
              count.as('pcrs'),
              countWhere(sql`c.status not in ('draft', 'void')`).as('billed'),
              countWhere(sql`c.status = 'draft'`).as('drafts'),
              countWhere(sql`c.status = 'void'`).as('voided'),
              countWhere(
                sql`c.id is null and exists (select 1 from claims o where o.agency_id = i.agency_id and o.pcr_number = ir.pcr_number)`
              ).as('revisions'),
              countWhere(
                sql`c.id is null and not exists (select 1 from claims o where o.agency_id = i.agency_id and o.pcr_number = ir.pcr_number)`
              ).as('no_claim'),
              centsWhere(sql.ref('c.total_cents'), sql`c.status not in ('draft', 'void')`).as(
                'charges'
              )
            ])
            .whereRef('ir.import_id', '=', 'i.id')
            .as('x'),
        (join) => join.onTrue()
      )
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('workflow_runs as ch')
            .select(countWhere(sql`ch.status in ('faulted', 'failed')`).as('failed'))
            .whereRef('ch.parent_id', '=', 'i.run_id')
            .as('runs'),
        (join) => join.onTrue()
      )
      .select([
        'i.id',
        'i.created_at as received_at',
        'i.file_name',
        'i.source',
        sql<number>`coalesce(i.report_count, x.pcrs)`.as('pcrs'),
        'x.billed',
        'x.drafts',
        'x.voided',
        'x.revisions',
        'x.no_claim',
        'runs.failed',
        'x.charges as charges_cents'
      ])
      .where('i.agency_id', '=', ctx.agencyId)
      .where(within(sql.ref('i.created_at'), ctx))
      .as('r'),
  columns: [
    'id',
    'received_at',
    'file_name',
    'source',
    'pcrs',
    'billed',
    'drafts',
    'voided',
    'revisions',
    'no_claim',
    'failed',
    'charges_cents'
  ],
  order: 'received_at',
  tiebreak: 'id',
  dir: 'asc',
  totals: ['pcrs', 'billed', 'drafts', 'voided', 'revisions', 'no_claim', 'failed', 'charges_cents']
});
