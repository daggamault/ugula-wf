import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBatchDocument } from './queries.ts';

describe('submission queries', () => {
  it('find a batch file only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findBatchDocument(db, 't1', 'b1'), null);
    assert.ok(queries[0]?.sql.includes('where "agency_id" = $1 and "id" = $2'));
    assert.deepEqual(queries[0]?.parameters, ['t1', 'b1']);
    await db.destroy();
  });
});
