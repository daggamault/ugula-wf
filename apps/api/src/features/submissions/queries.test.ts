import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  allocateControlNumber,
  findBatchDocument,
  findReadyClaim,
  insertBatch,
  insertSubmissionEvent,
  lockReadyClaim,
  markSubmitted
} from './queries.ts';

describe('submission queries', () => {
  it('read one ready claim of the tenant, locking it when submitting', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findReadyClaim(db, 't1', 'c1'), undefined);
    await lockReadyClaim(db, 't1', 'c1');
    const [find, lock] = queries;
    assert.ok(
      find?.sql.includes('where "c"."tenant_id" = $1 and "c"."id" = $2 and "c"."status" = $3')
    );
    assert.deepEqual(find?.parameters.slice(-3), ['t1', 'c1', 'ready']);
    assert.ok(find?.sql.includes('coalesce(dp.name, cc.payer_name)'));
    assert.ok(lock?.sql.endsWith('for update of "c"'));
    await db.destroy();
  });

  it('allocate control numbers from the billing profile until they run out', async () => {
    const { db, queries } = createRecordingDb(() => [{ control_number: 4 }]);
    assert.equal(await allocateControlNumber(db, 't1'), 4);
    assert.equal(
      queries[0]?.sql,
      'update "billing_profiles" set "next_control_number" = next_control_number + 1 where "tenant_id" = $1 and "next_control_number" <= $2 returning next_control_number - 1 as "control_number"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1', 999_999_999]);
    const used = createRecordingDb(() => []);
    assert.equal(await allocateControlNumber(used.db, 't1'), null);
    await db.destroy();
  });

  it('write the batch, its submission event and move the claim on', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'b1' }]);
    await insertBatch(db, {
      id: 'b1',
      tenantId: 't1',
      controlNumber: 7,
      totalCents: 100,
      production: false,
      document: { key: 'k' },
      createdBy: 'u1'
    });
    await insertSubmissionEvent(
      db,
      { batchId: 'b1', note: '837P file #7', createdBy: 'u1' },
      { claimId: 'c1', kind: 'submitted', coverageId: 'cc1' }
    );
    await markSubmitted(db, 'c1');
    const [batch, event, status] = queries;
    assert.deepEqual(batch?.parameters.slice(0, 4), ['b1', 't1', 7, 1]);
    assert.deepEqual(event?.parameters, ['c1', 'submitted', 'cc1', '837P file #7', 'b1', 'u1']);
    assert.ok(status?.sql.startsWith('update "claims" set "status" = $1'));
    assert.deepEqual(status?.parameters, ['submitted', 'c1', 'ready']);
    await db.destroy();
  });

  it('find a batch file only within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findBatchDocument(db, 't1', 'b1'), null);
    assert.deepEqual(queries[0]?.parameters, ['t1', 'b1']);
    await db.destroy();
  });
});
