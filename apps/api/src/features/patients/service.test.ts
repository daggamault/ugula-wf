import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createPatientService } from './service.ts';

describe('patient service', () => {
  it('pages search results and reports missing patients', async () => {
    const { db } = createRecordingDb(() => []);
    const service = createPatientService({ db });
    const list = await service.list('t-1', { page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
    assert.deepEqual(list, { ok: true, value: { items: [], total: 0, page: 1, pageSize: 25 } });
    assert.equal((await service.find('t-1', 'p-1')).ok, false);
    await db.destroy();
  });
});
