import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, servedIn, UNBILLED } from './report-sql.ts';

export const hcpcsReport = report({
  dates: 'service',
  rows: (db, ctx) =>
    db
      .selectFrom('claim_lines as l')
      .innerJoin('claims as c', 'c.id', 'l.claim_id')
      .leftJoin('codes as d', (j) =>
        j.on('d.code_set', '=', 'hcpcs').onRef('d.code', '=', 'l.code')
      )
      .select([
        'l.code',
        'd.description',
        sql<number>`count(distinct l.claim_id)::int`.as('claims'),
        sql<number>`sum(l.units)::float8`.as('units'),
        cents(sql.ref('l.total_cents')).as('charges_cents')
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .groupBy(['l.code', 'd.description'])
      .as('r'),
  columns: ['code', 'description', 'claims', 'units', 'charges_cents'],
  order: 'charges_cents',
  tiebreak: 'code',
  dir: 'desc',
  totals: ['charges_cents']
});
