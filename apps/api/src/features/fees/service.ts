import type { Db } from '@ugula/db';
import type { Writes } from '../../shared/access.ts';
import { fail, ok } from '../../shared/result.ts';
import {
  deleteFee,
  type FeeFilters,
  findFee,
  payerExists,
  saveFee,
  searchFees
} from './queries.ts';
import type { FeeInput } from './schemas.ts';

export const createFeeService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, filters: FeeFilters) =>
    ok(await searchFees(db, agencyId, filters)),
  find: async (agencyId: string, id: string) => {
    const fee = await findFee(db, agencyId, id);
    return fee ? ok({ fee }) : fail('not_found', 'Fee not found');
  },
  save: async (agencyId: string, input: FeeInput, writes: Writes) => {
    if (!writes.create && !writes.update) return fail('forbidden', "You can't save fees");
    if (input.payerId !== null && !(await payerExists(db, agencyId, input.payerId))) {
      return fail('invalid', 'Choose a payer from the payer directory');
    }
    const fee = await saveFee(db, agencyId, input, writes);
    return fee
      ? ok({ fee })
      : fail('forbidden', writes.create ? "You can't change fees" : "You can't add fees");
  },
  remove: async (agencyId: string, id: string) =>
    (await deleteFee(db, agencyId, id))
      ? ok({ status: 'deleted' })
      : fail('not_found', 'Fee not found')
});

export type FeeService = ReturnType<typeof createFeeService>;
