import { payerDocument } from '@ugula/billing';
import type { Db } from '@ugula/db';
import type { Embedder } from '@ugula/inference';
import { type Announce, announced } from '../../shared/live.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteAlias,
  deletePayer,
  findPayer,
  linkCoverages,
  listPayerNames,
  type PayerFilters,
  saveEmbedding,
  searchPayers,
  upsertPayer
} from './queries.ts';
import type { PayerInput } from './schemas.ts';

type PayerServiceDeps = { db: Db; announce: Announce; embedder: Embedder };

export const createPayerService = ({ db, announce, embedder }: PayerServiceDeps) => {
  const embed = async (tenantId: string, id: string, input: PayerInput) => {
    const [vector] = await embedder.embed([payerDocument(input)]);
    if (vector) await saveEmbedding(db, tenantId, id, vector);
    return vector !== undefined;
  };
  return {
    search: async (tenantId: string, filters: PayerFilters) =>
      ok(await searchPayers(db, tenantId, filters)),
    names: async (tenantId: string, text?: string) =>
      ok({ payers: await listPayerNames(db, tenantId, text) }),
    find: async (tenantId: string, id: string) => {
      const payer = await findPayer(db, tenantId, id);
      return payer ? ok({ payer }) : fail('not_found', 'Payer not found');
    },
    save: async (tenantId: string, input: PayerInput) => {
      const saved = await announced(
        announce,
        tenantId,
        db.transaction().execute(async (tx) => {
          const { unembedded, ...payer } = await upsertPayer(tx, tenantId, input);
          return ok({ payer, unembedded, linkedClaims: await linkCoverages(tx, tenantId, payer) });
        }),
        ({ linkedClaims }) => (linkedClaims ? [{ kind: 'claim', id: null }] : [])
      );
      if (!saved.ok) return saved;
      const { unembedded, ...value } = saved.value;
      const embedded =
        !unembedded || (await embed(tenantId, value.payer.id, input).catch(() => false));
      return ok({ ...value, embedded });
    },
    remove: async (tenantId: string, id: string) =>
      (await deletePayer(db, tenantId, id))
        ? ok({ status: 'deleted' })
        : fail('not_found', 'Payer not found'),
    forget: async (tenantId: string, payerId: string, aliasId: string) =>
      (await deleteAlias(db, tenantId, payerId, aliasId))
        ? ok({ status: 'deleted' })
        : fail('not_found', 'Payer name not found')
  };
};

export type PayerService = ReturnType<typeof createPayerService>;
