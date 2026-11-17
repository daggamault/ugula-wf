import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createDepositService } from './service.ts';

const input = {
  traceNumber: 'EFT1',
  amountCents: 1000,
  depositedOn: '2026-11-02',
  payerName: 'Medicare',
  note: null
};

describe('deposit service', () => {
  it('records a deposit and emits Deposit Recorded in the same transaction', async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      sql.startsWith('insert') ? [{ id: 'd1' }] : []
    );
    assert.deepEqual(await createDepositService({ db }).record('t-1', 'u-1', input), {
      ok: true,
      value: { id: 'd1' }
    });
    const event = queries.find((q) => q.sql.startsWith('insert into "events"'));
    assert.deepEqual(event?.parameters, ['t-1', 'deposit.recorded', '{"depositId":"d1"}', 'u-1']);
  });

  it('refuses a trace number already recorded without emitting', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await createDepositService({ db }).record('t-1', 'u-1', input), {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'A deposit with trace number EFT1 is already recorded'
      }
    });
    assert.equal(
      queries.some((q) => q.sql.startsWith('insert into "events"')),
      false
    );
  });

  it('finds a deposit or says it is not found', async () => {
    const found = createDepositService({ db: createRecordingDb(() => [{ id: 'd1' }]).db });
    assert.deepEqual(await found.find('t-1', 'd1'), { ok: true, value: { deposit: { id: 'd1' } } });
    const missing = createDepositService({ db: createRecordingDb().db });
    assert.deepEqual(await missing.find('t-1', 'd1'), {
      ok: false,
      failure: { code: 'not_found', message: 'Deposit not found' }
    });
    assert.deepEqual(
      await missing.search('t-1', { page: 1, pageSize: 25, sort: 'deposited', dir: 'desc' }),
      { ok: true, value: { items: [], total: 0, page: 1, pageSize: 25 } }
    );
  });
});
