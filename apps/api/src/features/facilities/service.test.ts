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
  hasContract: true,
  contractNote: null
};

const failing = (code: string) =>
  createFacilityService({
    db: createRecordingDb(() => {
      throw Object.assign(new Error('pg'), { code });
    }).db
  });

const NOT_FOUND = { ok: false, failure: { code: 'not_found', message: 'Facility not found' } };

const TAKEN = {
  ok: false,
  failure: { code: 'conflict', message: 'A facility named Sunrise SNF already exists' }
};

describe('facility service', () => {
  it('searches, creates, finds, updates and deletes agency facilities', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('group by 1')
        ? [{ value: 'snf', label: null, count: '1' }]
        : [{ id: 'f1', total: '1' }]
    );
    const service = createFacilityService({ db });
    assert.deepEqual(
      await service.search('t-1', { page: 1, pageSize: 25, sort: 'name', dir: 'asc', kind: [] }),
      {
        ok: true,
        value: {
          items: [{ id: 'f1' }],
          total: 1,
          page: 1,
          pageSize: 25,
          facets: { kind: [{ value: 'snf', count: 1 }] }
        }
      }
    );
    assert.deepEqual(await service.create('t-1', input), { ok: true, value: { id: 'f1' } });
    assert.deepEqual(await service.find('t-1', 'f1'), {
      ok: true,
      value: { facility: { id: 'f1', total: '1' } }
    });
    assert.deepEqual(await service.update('t-1', 'f1', input), { ok: true, value: { id: 'f1' } });
    assert.deepEqual(await service.remove('t-1', 'f1'), { ok: true, value: { id: 'f1' } });
    assert.ok(queries.every((q) => q.parameters.includes('t-1')));
  });

  it('reports facilities outside the agency as not found', async () => {
    const service = createFacilityService({ db: createRecordingDb(() => []).db });
    assert.deepEqual(await service.find('t-1', 'f1'), NOT_FOUND);
    assert.deepEqual(await service.update('t-1', 'f1', input), NOT_FOUND);
    assert.deepEqual(await service.remove('t-1', 'f1'), NOT_FOUND);
  });

  it('refuses a name another agency facility already has', async () => {
    const service = createFacilityService({ db: createRecordingDb(() => []).db });
    assert.deepEqual(await service.create('t-1', input), TAKEN);
    assert.deepEqual(await failing('23505').update('t-1', 'f1', input), TAKEN);
  });

  it('keeps a facility that claims or invoices still point to', async () => {
    assert.deepEqual(await failing('23503').remove('t-1', 'f1'), {
      ok: false,
      failure: {
        code: 'conflict',
        message:
          'This facility is responsible for claims or has been invoiced, so it cannot be deleted'
      }
    });
  });

  it('lets other database errors surface', async () => {
    const broken = failing('57014');
    await assert.rejects(broken.update('t-1', 'f1', input), { code: '57014' });
    await assert.rejects(broken.remove('t-1', 'f1'), { code: '57014' });
  });
});

describe('facility service hospitals', () => {
  it('answers the CMS hospitals a search finds', async () => {
    const row = { ccn: '010001', name: 'SOUTHEAST HEALTH MEDICAL CENTER' };
    const service = createFacilityService({ db: createRecordingDb(() => [row]).db });
    assert.deepEqual(await service.hospitals('southeast'), {
      ok: true,
      value: { hospitals: [row] }
    });
  });
});
