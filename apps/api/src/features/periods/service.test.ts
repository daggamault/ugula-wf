import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createPeriodService } from './service.ts';

describe('period service', () => {
  it('searches the agency closed periods', async () => {
    const { db } = createRecordingDb();
    assert.deepEqual(
      await createPeriodService({ db }).search('t-1', {
        page: 1,
        pageSize: 25,
        sort: 'period',
        dir: 'desc'
      }),
      { ok: true, value: { items: [], total: 0, page: 1, pageSize: 25 } }
    );
  });
});
