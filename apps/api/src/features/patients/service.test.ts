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
    const missing = await service.find('t-1', 'p-1');
    assert.equal(!missing.ok && missing.failure.code, 'not_found');
    await db.destroy();
  });

  it('opens a patient of the agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'p-1', last_name: 'Doe' }]);
    const service = createPatientService({ db });
    assert.deepEqual(await service.find('t-1', 'p-1'), {
      ok: true,
      value: { patient: { id: 'p-1', last_name: 'Doe' } }
    });
    assert.ok(queries[0]?.sql.includes('"p"."agency_id" = $1'));
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'p-1']);
    await db.destroy();
  });
});
