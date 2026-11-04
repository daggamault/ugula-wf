import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteFee,
  type FeeFilters,
  findFee,
  payerExists,
  searchFees,
  upsertFee
} from './queries.ts';
import type { FeeInput } from './schemas.ts';

export const createFeeService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, filters: FeeFilters) =>
    ok(await searchFees(db, agencyId, filters)),
  find: async (agencyId: string, id: string) => {
    const fee = await findFee(db, agencyId, id);
    return fee ? ok({ fee }) : fail('not_found', 'Fee not found');
  },
  save: async (agencyId: string, fee: FeeInput) =>
    fee.payerId !== null && !(await payerExists(db, agencyId, fee.payerId))
      ? fail('invalid', 'Choose a payer from the payer directory')
      : ok({ fee: await upsertFee(db, agencyId, fee) }),
  remove: async (agencyId: string, id: string) =>
    (await deleteFee(db, agencyId, id))
      ? ok({ status: 'deleted' })
      : fail('not_found', 'Fee not found')
});

export type FeeService = ReturnType<typeof createFeeService>;
