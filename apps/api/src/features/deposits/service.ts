import { type Db, emitEvent } from '@ugula/db';
import { fail, ok } from '../../shared/result.ts';
import { type DepositFilters, findDeposit, insertDeposit, searchDeposits } from './queries.ts';
import type { DepositInput } from './schemas.ts';

const DEPOSIT_RECORDED = 'deposit.recorded';

export const createDepositService = ({ db }: { db: Db }) => ({
  search: async (agencyId: string, filters: DepositFilters) =>
    ok(await searchDeposits(db, agencyId, filters)),

  find: async (agencyId: string, id: string) => {
    const deposit = await findDeposit(db, agencyId, id);
    return deposit ? ok({ deposit }) : fail('not_found', 'Deposit not found');
  },

  record: async (agencyId: string, userId: string, input: DepositInput) => {
    const created = await db.transaction().execute(async (tx) => {
      const row = await insertDeposit(tx, agencyId, userId, input);
      if (row) {
        await emitEvent(tx, {
          agencyId,
          type: DEPOSIT_RECORDED,
          payload: { depositId: row.id },
          createdBy: userId
        });
      }
      return row;
    });
    return created
      ? ok({ id: created.id })
      : fail('conflict', `A deposit with trace number ${input.traceNumber} is already recorded`);
  }
});

export type DepositService = ReturnType<typeof createDepositService>;
