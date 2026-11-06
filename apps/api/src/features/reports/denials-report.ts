import { payerName } from '@ugula/db';
import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, count, reasonCode, within } from './report-sql.ts';

export const denialsReport = report({
  dates: 'posted',
  groups: ['payer', 'reason'],
  rows: (db, ctx) =>
    db
      .selectFrom('claim_event_adjustments as a')
      .innerJoin('claim_events as e', 'e.id', 'a.event_id')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .leftJoin('claim_coverages as cc', 'cc.id', 'e.coverage_id')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .leftJoin('codes as d', (j) =>
        j.on('d.code_set', '=', 'carc').onRef('d.code', '=', 'a.reason_code')
      )
      .select([
        (ctx.group === 'reason'
          ? sql<string | null>`null`
          : sql<string | null>`case when cc.id is null then null else ${payerName} end`
        ).as('payer'),
        reasonCode.as('code'),
        'd.description',
        count.as('adjustments'),
        sql<number>`(count(distinct e.id) filter (where e.paid_cents = 0))::int`.as('denials'),
        sql<number>`count(distinct e.claim_id)::int`.as('claims'),
        cents(sql.ref('a.amount_cents')).as('amount_cents')
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('e.kind', '=', 'response')
      .where(within(sql.ref('e.created_at'), ctx))
      .groupBy([sql`1`, sql`2`, sql`3`])
      .as('r'),
  columns: ['payer', 'code', 'description', 'adjustments', 'denials', 'claims', 'amount_cents'],
  order: 'amount_cents',
  tiebreak: 'code',
  dir: 'desc',
  totals: ['adjustments', 'denials', 'amount_cents']
});
