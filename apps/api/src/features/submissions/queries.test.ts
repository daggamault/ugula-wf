import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBatchDocument, findEligibilityClaim } from './queries.ts';

describe('submission queries', () => {
  it('find a batch file only within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findBatchDocument(db, 't1', 'b1'), null);
    assert.ok(queries[0]?.sql.includes('where "tenant_id" = $1 and "id" = $2'));
    assert.deepEqual(queries[0]?.parameters, ['t1', 'b1']);
    await db.destroy();
  });

  it('find a claim with its coverages in payer order only within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findEligibilityClaim(db, 't1', 'c1'), undefined);
    const [claim] = queries;
    assert.ok(claim?.sql.includes('where "cc"."claim_id" = "c"."id" order by "cc"."position"'));
    assert.ok(claim?.sql.includes('where "c"."tenant_id" = $1 and "c"."id" = $2'));
    assert.deepEqual(claim?.parameters, ['t1', 'c1']);
    await db.destroy();
  });
});
