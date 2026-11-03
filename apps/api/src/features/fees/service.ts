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
  search: async (tenantId: string, filters: FeeFilters) =>
    ok(await searchFees(db, tenantId, filters)),
  find: async (tenantId: string, id: string) => {
    const fee = await findFee(db, tenantId, id);
    return fee ? ok({ fee }) : fail('not_found', 'Fee not found');
  },
  save: async (tenantId: string, fee: FeeInput) =>
    fee.payerId !== null && !(await payerExists(db, tenantId, fee.payerId))
      ? fail('invalid', 'Choose a payer from the payer directory')
      : ok({ fee: await upsertFee(db, tenantId, fee) }),
  remove: async (tenantId: string, id: string) =>
    (await deleteFee(db, tenantId, id))
      ? ok({ status: 'deleted' })
      : fail('not_found', 'Fee not found')
});

export type FeeService = ReturnType<typeof createFeeService>;
