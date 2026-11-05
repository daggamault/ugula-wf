import { payerName } from '@ugula/db';
import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, centsWhere, count, countWhere, servedIn, UNBILLED, zero } from './report-sql.ts';

const hasReasons = sql<boolean>`exists (select 1 from claim_event_adjustments a where a.event_id = e.id)`;

export const payersReport = report({
  dates: 'service',
  groups: ['payer', 'class'],
  rows: (db, ctx) => {
    const coverages = db
      .selectFrom('claim_coverages as cc')
      .innerJoin('claims as c', 'c.id', 'cc.claim_id')
      .leftJoin('payers as dp', 'dp.id', 'cc.payer_id')
      .innerJoinLateral(
        (eb) =>
          eb
            .selectFrom('claim_events as e')
            .select([
              sql<Date | null>`min(e.created_at) filter (where e.kind in ('submitted', 'resubmitted'))`.as(
                'first_submitted'
              ),
              sql<Date | null>`min(e.created_at) filter (where e.kind = 'response' and e.paid_cents > 0)`.as(
                'first_paid'
              ),
              countWhere(sql`e.kind = 'response'`).as('responses'),
              countWhere(sql`e.kind = 'response' and e.paid_cents = 0 and ${hasReasons}`).as(
                'denials'
              ),
              cents(sql.ref('e.paid_cents')).as('paid'),
              cents(sql.ref('e.adjusted_cents')).as('adjusted')
            ])
            .whereRef('e.coverage_id', '=', 'cc.id')
            .as('a'),
        (join) => join.onTrue()
      )
      .leftJoin('facilities as f', 'f.id', 'c.facility_id')
      .select([
        (ctx.group === 'class'
          ? sql<string | null>`coalesce(dp.claim_filing, '')`
          : sql<string | null>`${payerName}`
        ).as('name'),
        sql<boolean>`bool_and(cc.payer_id is not null)`.as('in_directory'),
        count.as('billed'),
        cents(sql.ref('c.total_cents')).as('charges_cents'),
        cents(sql.ref('a.paid')).as('paid_cents'),
        cents(sql.ref('a.adjusted')).as('adjusted_cents'),
        sql<number>`sum(a.responses)::int`.as('responses'),
        sql<number>`sum(a.denials)::int`.as('denials'),
        countWhere(sql`a.first_paid >= a.first_submitted`).as('paid_claims'),
        centsWhere(
          sql`extract(epoch from a.first_paid - a.first_submitted) / 86400`,
          sql`a.first_paid >= a.first_submitted`
        ).as('pay_days')
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .where(sql<boolean>`a.first_submitted is not null or a.responses > 0`)
      .groupBy(sql`1`);
    const patient = db
      .selectFrom('claim_events as e')
      .innerJoin('claims as c', 'c.id', 'e.claim_id')
      .select([
        sql<string | null>`null`.as('name'),
        sql<boolean>`true`.as('in_directory'),
        zero.as('billed'),
        zero.as('charges_cents'),
        cents(sql.ref('e.paid_cents')).as('paid_cents'),
        cents(sql.ref('e.adjusted_cents')).as('adjusted_cents'),
        zero.as('responses'),
        zero.as('denials'),
        zero.as('paid_claims'),
        zero.as('pay_days')
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('e.kind', '=', 'response')
      .where('e.coverage_id', 'is', null)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .having(sql<boolean>`count(*) > 0`);
    return coverages.unionAll(patient).as('r');
  },
  columns: [
    'name',
    'in_directory',
    'billed',
    'charges_cents',
    'paid_cents',
    'adjusted_cents',
    'responses',
    'denials',
    'paid_claims',
    'pay_days'
  ],
  order: 'paid_cents',
  tiebreak: 'name',
  dir: 'desc',
  totals: [
    'billed',
    'charges_cents',
    'paid_cents',
    'adjusted_cents',
    'responses',
    'denials',
    'paid_claims',
    'pay_days'
  ]
});
