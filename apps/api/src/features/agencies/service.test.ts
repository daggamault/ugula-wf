import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createAgencyService } from './service.ts';

describe('agency service', () => {
  it('lists agencies and resolves access for a user', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createAgencyService({ db });
    assert.deepEqual(await service.list('u-1'), []);
    assert.equal(await service.access('u-1', 't-1'), null);
    assert.equal(queries.length, 2);
    assert.equal(queries[1]?.parameters.at(-1), 't-1');
    await db.destroy();
  });
});
