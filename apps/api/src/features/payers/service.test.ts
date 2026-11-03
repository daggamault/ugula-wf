import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createPayerService } from './service.ts';

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

describe('payer service', () => {
  it('searches, finds and saves payers and reports unknown deletes', async () => {
    const row = { id: 'p1', name: 'Medicare', payer_id: '00952', claim_filing: 'MB' };
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('delete') ? [] : [{ ...row, total: '1' }]
    );
    const { announce, events } = recordAnnouncements();
    const service = createPayerService({ db, announce });
    assert.deepEqual(await service.search('t-1', PAGE), {
      ok: true,
      value: { items: [row], total: 1, page: 1, pageSize: 25 }
    });
    assert.equal((await service.find('t-1', 'p1')).ok, true);
    assert.equal((await service.names('t-1')).ok, true);
    const saved = await service.save('t-1', {
      name: 'Medicare',
      payerId: '00952',
      claimFiling: 'MB'
    });
    assert.equal(saved.ok && saved.value.linkedClaims, 1);
    assert.deepEqual(events, [{ tenantId: 't-1', event: { kind: 'claim', id: null } }]);
    const removed = await service.remove('t-1', 'p1');
    assert.equal(!removed.ok && removed.failure.code, 'not_found');
    const forgotten = await service.forget('t-1', 'p1', 'a1');
    assert.equal(!forgotten.ok && forgotten.failure.code, 'not_found');
  });

  it('reports a payer outside the tenant as not found', async () => {
    const { db } = createRecordingDb(() => []);
    const service = createPayerService({ db, announce: recordAnnouncements().announce });
    const found = await service.find('t-1', 'p1');
    assert.equal(!found.ok && found.failure.code, 'not_found');
  });
});
