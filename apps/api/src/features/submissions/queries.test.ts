import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBatchDocument } from './queries.ts';

describe('submission queries', () => {
  it('find a batch file only within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findBatchDocument(db, 't1', 'b1'), null);
    assert.deepEqual(queries[0]?.parameters, ['t1', 'b1']);
    await db.destroy();
  });
});
