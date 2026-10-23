import type { Db } from '@ugula/db';
import { type Announce, announced } from '../../shared/live.ts';
import { fail, ok } from '../../shared/result.ts';
import { deletePayer, linkCoverages, listPayers, upsertPayer } from './queries.ts';
import type { PayerInput } from './schemas.ts';

export const createPayerService = ({ db, announce }: { db: Db; announce: Announce }) => ({
  list: async (tenantId: string) => ok({ payers: await listPayers(db, tenantId) }),

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
      : fail('not_found', 'Payer not found')
});

export type PayerService = ReturnType<typeof createPayerService>;
