import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createPayerService } from './service.ts';

describe('payer service', () => {
  it('lists and saves payers and reports unknown deletes', async () => {
    const row = { id: 'p1', name: 'Medicare', payer_id: '00952', claim_filing: 'MB' };
    const { db } = createRecordingDb((q) => (q.sql.startsWith('delete') ? [] : [row]));
    const { announce, events } = recordAnnouncements();
    const service = createPayerService({ db, announce });
    assert.deepEqual(await service.list('t-1'), { ok: true, value: { payers: [row] } });
    assert.deepEqual(
      await service.save('t-1', { name: 'Medicare', payerId: '00952', claimFiling: 'MB' }),
      { ok: true, value: { payer: row, linkedClaims: 1 } }
    );
    assert.deepEqual(events, [{ tenantId: 't-1', event: { kind: 'claim', id: null } }]);
    const removed = await service.remove('t-1', 'p1');
    assert.equal(!removed.ok && removed.failure.code, 'not_found');
    const forgotten = await service.forget('t-1', 'p1', 'a1');
    assert.equal(!forgotten.ok && forgotten.failure.code, 'not_found');
  });
});
