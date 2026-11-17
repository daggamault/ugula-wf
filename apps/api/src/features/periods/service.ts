import type { Db } from '@ugula/db';
import type { PageRequest } from '../../shared/paging.ts';
import { ok } from '../../shared/result.ts';
import { searchPeriods } from './queries.ts';
import type { PeriodSort } from './schemas.ts';

export const createPeriodService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, page: PageRequest<PeriodSort>) =>
    ok(await searchPeriods(db, agencyId, page))
});

export type PeriodService = ReturnType<typeof createPeriodService>;
