import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeService } from './service.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('fee service', () => {
  it('lists and saves fees and reports unknown deletes', async () => {
    const row = { id: 'f1', payer_id: null, payer: null, code: 'A0427', amount_cents: 95000 };
    const { db } = createRecordingDb((q) => (q.sql.startsWith('delete') ? [] : [row]));
    const service = createFeeService({ db });
    assert.deepEqual(await service.list('t-1'), { ok: true, value: { fees: [row] } });
    assert.deepEqual(
      await service.save('t-1', { payerId: null, code: 'A0427', amountCents: 95000 }),
      { ok: true, value: { fee: row } }
    );
    const removed = await service.remove('t-1', 'f1');
    assert.equal(!removed.ok && removed.failure.code, 'not_found');
  });

  it('refuses prices for payers outside the tenant directory', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const saved = await createFeeService({ db }).save('t-1', {
      payerId: PAYER,
      code: 'A0427',
      amountCents: 1
    });
    assert.equal(!saved.ok && saved.failure.code, 'invalid');
    assert.equal(queries.length, 1);
  });
});
