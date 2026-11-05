import { type Db, findAgencyAccess, listAccessibleAgencies } from '@ugula/db';

export const createAgencyService = ({ db }: { db: Db }) => ({
  list: (userId: string) => listAccessibleAgencies(db, userId),
  access: (userId: string, agencyId: string) => findAgencyAccess(db, userId, agencyId)
});

export type AgencyService = ReturnType<typeof createAgencyService>;
