import { payerName } from '@ugula/db';
import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, reasonCode, within } from './report-sql.ts';

export const denialsReport = report({
  dates: 'posted',
  groups: ['payer', 'reason'],
  rows: (db, ctx) =>
    db
      .selectFrom('claim_events as dn')
      .innerJoin('claim_events as e', (j) =>
        j
          .onRef('e.claim_id', '=', 'dn.claim_id')
          .on(sql<boolean>`e.source_key || ':denied' = dn.source_key`)
      )
      .innerJoin('claim_coverages as cc', 'cc.id', 'dn.coverage_id')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .leftJoin('claim_event_adjustments as a', 'a.event_id', 'e.id')
      .leftJoin('codes as d', (j) =>
        j.on('d.code_set', '=', 'carc').onRef('d.code', '=', 'a.reason_code')
      )
      .select([
        (ctx.group === 'reason' ? sql<string | null>`null` : sql<string | null>`${payerName}`).as(
          'payer'
        ),
        reasonCode.as('code'),
        'd.description',
        sql<number>`count(distinct dn.id)::int`.as('denials'),
        sql<number>`count(distinct dn.claim_id)::int`.as('claims'),
        cents(sql.ref('a.amount_cents')).as('amount_cents')
      ])
      .where('dn.agency_id', '=', ctx.agencyId)
      .where('dn.kind', '=', 'denied')
      .where(within(sql.ref('dn.created_at'), ctx))
      .groupBy([sql`1`, sql`2`, sql`3`])
      .as('r'),
  columns: ['payer', 'code', 'description', 'denials', 'claims', 'amount_cents'],
  order: 'denials',
  tiebreak: 'code',
  dir: 'desc',
  totals: ['amount_cents']
});
