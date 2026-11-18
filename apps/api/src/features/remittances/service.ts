import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import {
  findRemittance,
  findRemittancePayments,
  type RemittanceFilters,
  searchRemittances
} from './queries.ts';

export const createRemittanceService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, filters: RemittanceFilters) =>
    ok(await searchRemittances(db, agencyId, filters)),
  find: async (agencyId: string, id: string) => {
    const [remittance, payments] = await Promise.all([
      findRemittance(db, agencyId, id),
      findRemittancePayments(db, agencyId, id)
    ]);
    return remittance ? ok({ remittance, payments }) : fail('not_found', 'Remittance not found');
  }
});

export type RemittanceService = ReturnType<typeof createRemittanceService>;
