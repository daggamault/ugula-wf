import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFacilityService } from './service.ts';

const input = {
  name: 'Sunrise SNF',
  addressLine: null,
  city: null,
  state: null,
  postalCode: null,
  phone: null,
  kind: 'snf' as const,
  contract: true,
  contractNote: null
};

describe('facility service', () => {
  it('creates, finds, updates and deletes facilities, refusing duplicate names', async () => {
    const found = createRecordingDb(() => [{ id: 'f1' }]);
    const service = createFacilityService({ db: found.db });
    assert.deepEqual(await service.create('t', input), { ok: true, value: { id: 'f1' } });
    assert.deepEqual(await service.find('t', 'f1'), {
      ok: true,
      value: { facility: { id: 'f1' } }
    });
    assert.deepEqual(await service.update('t', 'f1', input), { ok: true, value: { id: 'f1' } });
    assert.deepEqual(await service.remove('t', 'f1'), { ok: true, value: { status: 'deleted' } });
    const none = createFacilityService({ db: createRecordingDb(() => []).db });
    assert.deepEqual(await none.create('t', input), {
      ok: false,
      failure: { code: 'conflict', message: 'A facility named Sunrise SNF already exists' }
    });
    for (const res of [
      await none.find('t', 'f1'),
      await none.update('t', 'f1', input),
      await none.remove('t', 'f1')
    ]) {
      assert.equal(res.ok ? 'ok' : res.failure.code, 'not_found');
    }
    const clash = createFacilityService({
      db: createRecordingDb(() => {
        throw Object.assign(new Error('duplicate'), { code: '23505' });
      }).db
    });
    assert.equal((await clash.update('t', 'f1', input)).ok, false);
    const used = createFacilityService({
      db: createRecordingDb(() => {
        throw Object.assign(new Error('still referenced'), { code: '23503' });
      }).db
    });
    assert.deepEqual(await used.remove('t', 'f1'), {
      ok: false,
      failure: {
        code: 'conflict',
        message:
          'This facility is responsible for claims or has been invoiced, so it cannot be deleted'
      }
    });
    assert.equal(
      (await none.search('t', { page: 1, pageSize: 25, sort: 'name', dir: 'asc' })).ok,
      true
    );
  });
});
