import { sql } from 'kysely';
import { report } from './report.ts';
import { cents, count, servedIn, UNBILLED } from './report-sql.ts';

export const levelsReport = report({
  dates: 'service',
  rows: (db, ctx) =>
    db
      .selectFrom('claims as c')
      .select([
        'c.level',
        'c.emergency',
        count.as('trips'),
        sql<number>`coalesce(sum(c.loaded_miles), 0)::float8`.as('miles'),
        cents(sql.ref('c.total_cents')).as('charges_cents')
      ])
      .where('c.agency_id', '=', ctx.agencyId)
      .where('c.status', 'not in', UNBILLED)
      .where(servedIn(ctx))
      .groupBy(['c.level', 'c.emergency'])
      .as('r'),
  columns: ['level', 'emergency', 'trips', 'miles', 'charges_cents'],
  order: 'charges_cents',
  tiebreak: 'level',
  dir: 'desc',
  totals: ['trips', 'miles', 'charges_cents']
});
