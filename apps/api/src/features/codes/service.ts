import type { Db } from '@ugula/db';
import { ok } from '../../shared/result.ts';
import { searchCodes } from './queries.ts';
import type { CodesQuery } from './schemas.ts';

export const createCodeService = ({ db }: { db: Db }) => ({
  find: async (query: CodesQuery) => ok({ codes: await searchCodes(db, query) })
});

export type CodeService = ReturnType<typeof createCodeService>;
