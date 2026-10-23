import type { Db } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { deleteFee, listFees, payerExists, upsertFee } from './queries.ts';
import type { FeeInput } from './schemas.ts';

export const createFeeService = ({ db }: { db: Db }) => ({
  list: async (tenantId: string) => ok({ fees: await listFees(db, tenantId) }),

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
