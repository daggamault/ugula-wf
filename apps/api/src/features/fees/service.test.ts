import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeService } from './service.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const ALL = { create: true, update: true };

const ROW = { id: 'f1', payer_id: null, payer: null, code: 'A0427', amount_cents: 95000 };

describe('fee service', () => {
  it('searches and finds fees within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ ...ROW, total: '1' }]);
    const service = createFeeService({ db });
    assert.deepEqual(
      await service.search('t-1', { page: 1, pageSize: 25, sort: 'payer', dir: 'asc' }),
      { ok: true, value: { items: [ROW], total: 1, page: 1, pageSize: 25 } }
    );
    assert.deepEqual(await service.find('t-1', 'f1'), {
      ok: true,
      value: { fee: { ...ROW, total: '1' } }
    });
    assert.deepEqual(queries[1]?.parameters, ['t-1', 'f1']);
  });

  it('reports unknown fees as not found', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createFeeService({ db });
    const notFound = { ok: false, failure: { code: 'not_found', message: 'Fee not found' } };
    assert.deepEqual(await service.find('t-1', 'f1'), notFound);
    assert.deepEqual(await service.remove('t-1', 'f1'), notFound);
    assert.deepEqual(queries[1]?.parameters, ['f1', 't-1']);
  });

  it('removes an agency fee', async () => {
    const { db } = createRecordingDb(() => [{ id: 'f1' }]);
    assert.deepEqual(await createFeeService({ db }).remove('t-1', 'f1'), {
      ok: true,
      value: { id: 'f1' }
    });
  });

  it('saves a default fee and a payer fee once the payer is in the agency directory', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    const service = createFeeService({ db });
    assert.deepEqual(
      await service.save('t-1', { payerId: null, code: 'A0427', amountCents: 95000 }, ALL),
      { ok: true, value: { fee: ROW } }
    );
    assert.equal(queries.length, 1);
    assert.deepEqual(
      await service.save('t-1', { payerId: PAYER, code: 'A0427', amountCents: 95000 }, ALL),
      { ok: true, value: { fee: ROW } }
    );
    assert.deepEqual(queries[1]?.parameters, [PAYER, 't-1']);
    assert.ok(queries[2]?.sql.startsWith('with "saved" as (insert into "fee_schedules"'));
  });

  it('refuses prices for payers outside the agency directory', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createFeeService({ db });
    assert.deepEqual(
      await service.save('t-1', { payerId: PAYER, code: 'A0427', amountCents: 1 }, ALL),
      {
        ok: false,
        failure: { code: 'invalid', message: 'Choose a payer from the payer directory' }
      }
    );
    assert.equal(queries.length, 1);
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
    assert.deepEqual(await service.save('t-1', fee, { create: false, update: false }), {
      ok: false,
      failure: { code: 'forbidden', message: "You can't save fees" }
    });
    assert.equal(queries.length, 2);
  });
});
