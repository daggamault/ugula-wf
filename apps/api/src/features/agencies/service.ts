import type { Db } from '@ugula/db';
import { findAgencyAccess, listAccessibleAgencies } from './queries.ts';

export const createAgencyService = ({ db }: { db: Db }) => ({
  list: (userId: string) => listAccessibleAgencies(db, userId),
  access: (userId: string, agencyId: string) => findAgencyAccess(db, userId, agencyId)
});

export type AgencyService = ReturnType<typeof createAgencyService>;
