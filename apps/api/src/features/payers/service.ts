import type { Db } from '@ugula/db';
import { type Announce, announced } from '../../shared/live.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteAlias,
  deletePayer,
  findPayer,
  linkCoverages,
  listPayerNames,
  type PayerFilters,
  searchPayers,
  upsertPayer
} from './queries.ts';
import type { PayerInput } from './schemas.ts';

export const createPayerService = ({ db, announce }: { db: Db; announce: Announce }) => ({
  search: async (tenantId: string, filters: PayerFilters) =>
    ok(await searchPayers(db, tenantId, filters)),
  names: async (tenantId: string) => ok({ payers: await listPayerNames(db, tenantId) }),
  find: async (tenantId: string, id: string) => {
    const payer = await findPayer(db, tenantId, id);
    return payer ? ok({ payer }) : fail('not_found', 'Payer not found');
  },
  save: (tenantId: string, input: PayerInput) =>
    announced(
      announce,
      tenantId,
      db.transaction().execute(async (tx) => {
        const payer = await upsertPayer(tx, tenantId, input);
        return ok({ payer, linkedClaims: await linkCoverages(tx, tenantId, payer) });
      }),
      ({ linkedClaims }) => (linkedClaims ? [{ kind: 'claim', id: null }] : [])
    ),
  remove: async (tenantId: string, id: string) =>
    (await deletePayer(db, tenantId, id))
      ? ok({ status: 'deleted' })
      : fail('not_found', 'Payer not found'),
  forget: async (tenantId: string, payerId: string, aliasId: string) =>
    (await deleteAlias(db, tenantId, payerId, aliasId))
      ? ok({ status: 'deleted' })
      : fail('not_found', 'Payer name not found')
});

export type PayerService = ReturnType<typeof createPayerService>;
