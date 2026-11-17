import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { PeriodSort } from './schemas.ts';

export const searchPeriods = (db: Db, agencyId: string, page: PageRequest<PeriodSort>) =>
  paged(
    db
      .selectFrom('accounting_periods as p')
      .leftJoin('users as u', 'u.id', 'p.closed_by_id')
      .select(['p.period_on', 'p.closed_at', 'u.email as closed_by'])
      .where('p.agency_id', '=', agencyId),
    page,
    { period: sql.ref('p.period_on') },
    sql.ref('p.period_on')
  );
