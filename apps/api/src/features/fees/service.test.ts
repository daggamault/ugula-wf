import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeService } from './service.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const ALL = { create: true, update: true };

describe('fee service', () => {
  it('searches, finds and saves fees and reports unknown deletes', async () => {
    const row = { id: 'f1', payer_id: null, payer: null, code: 'A0427', amount_cents: 95000 };
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('delete') ? [] : [{ ...row, total: '1' }]
    );
    const service = createFeeService({ db });
    assert.deepEqual(
      await service.search('t-1', { page: 1, pageSize: 25, sort: 'payer', dir: 'asc' }),
      { ok: true, value: { items: [row], total: 1, page: 1, pageSize: 25 } }
    );
    assert.equal((await service.find('t-1', 'f1')).ok, true);
    const saved = await service.save(
      't-1',
      { payerId: null, code: 'A0427', amountCents: 95000 },
      ALL
    );
    assert.equal(saved.ok && saved.value.fee.code, 'A0427');
    const removed = await service.remove('t-1', 'f1');
    assert.equal(!removed.ok && removed.failure.code, 'not_found');
  });

  it('refuses prices for payers outside the agency directory', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createFeeService({ db });
    const saved = await service.save('t-1', { payerId: PAYER, code: 'A0427', amountCents: 1 }, ALL);
    assert.equal(!saved.ok && saved.failure.code, 'invalid');
    assert.equal(queries.length, 1);
    const found = await service.find('t-1', 'f1');
    assert.equal(!found.ok && found.failure.code, 'not_found');
  });

  it('adds fees only with create and changes them only with update', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createFeeService({ db });
    const fee = { payerId: null, code: 'A0427', amountCents: 1 };
    assert.deepEqual(await service.save('t-1', fee, { create: false, update: true }), {
      ok: false,
      failure: { code: 'forbidden', message: "You can't add fees" }
    });
    assert.ok(queries[0]?.sql.startsWith('with "saved" as (update "fee_schedules"'));
    assert.deepEqual(await service.save('t-1', fee, { create: true, update: false }), {
      ok: false,
      failure: { code: 'forbidden', message: "You can't change fees" }
    });
    assert.ok(queries[1]?.sql.includes('on conflict ("agency_id", "payer_id", "code") do nothing'));
    const none = await service.save('t-1', fee, { create: false, update: false });
    assert.equal(!none.ok && none.failure.code, 'forbidden');
    assert.equal(queries.length, 2);
  });
});
