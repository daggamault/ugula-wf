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
  const embed = async (agencyId: string, id: string, input: PayerInput) => {
    const [vector] = await embedder.embed([payerDocument(input)]);
    if (vector) await saveEmbedding(db, agencyId, id, vector);
    return vector !== undefined;
  };
  return {
    search: async (agencyId: string, filters: PayerFilters) =>
      ok(await searchPayers(db, agencyId, filters)),
    names: async (agencyId: string, text?: string) =>
      ok({ payers: await listPayerNames(db, agencyId, text) }),
    find: async (agencyId: string, id: string) => {
      const payer = await findPayer(db, agencyId, id);
      return payer ? ok({ payer }) : fail('not_found', 'Payer not found');
    },
    save: async (agencyId: string, input: PayerInput) => {
      const saved = await announced(
        announce,
        agencyId,
        db.transaction().execute(async (tx) => {
          const { unembedded, ...payer } = await upsertPayer(tx, agencyId, input);
          return ok({ payer, unembedded, linkedClaims: await linkCoverages(tx, agencyId, payer) });
        }),
        ({ linkedClaims }) => (linkedClaims ? [{ kind: 'claim', id: null }] : [])
      );
      if (!saved.ok) return saved;
      const { unembedded, ...value } = saved.value;
      const embedded =
        !unembedded || (await embed(agencyId, value.payer.id, input).catch(() => false));
      return ok({ ...value, embedded });
    },
    remove: async (agencyId: string, id: string) =>
      (await deletePayer(db, agencyId, id))
        ? ok({ status: 'deleted' })
        : fail('not_found', 'Payer not found'),
    forget: async (agencyId: string, payerId: string, aliasId: string) =>
      (await deleteAlias(db, agencyId, payerId, aliasId))
        ? ok({ status: 'deleted' })
        : fail('not_found', 'Payer name not found')
  };
};

export type PayerService = ReturnType<typeof createPayerService>;
