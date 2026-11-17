import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBatchDocument } from './queries.ts';

describe('submission queries', () => {
  it('finds a batch file and its control number within the agency', async () => {
    const batch = { document: 'ISA*00~', control_number: '000000001' };
    const { db, queries } = createRecordingDb(() => [batch]);
    assert.deepEqual(await findBatchDocument(db, 't1', 'b1'), batch);
    assert.equal(
      queries[0]?.sql,
      'select "document", "control_number" from "claim_batches" where "agency_id" = $1 and "id" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1', 'b1']);
  });

  it('finds no batch outside the agency', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findBatchDocument(db, 't1', 'b1'), null);
  });
});
