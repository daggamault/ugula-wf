import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  findBatchClaims,
  findClaimByNumber,
  findTracedCoverage,
  insertAcknowledgment,
  saveFileItems
} from './queries.ts';

describe('payer file queries', () => {
  it('finds claims by the number billed as CLM01 and batches by control number', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findClaimByNumber(db, 't1', 'not a number'), undefined);
    await findClaimByNumber(db, 't1', ' 1001 ');
    assert.deepEqual(queries[0]?.parameters, ['t1', 1001]);
    assert.deepEqual(await findBatchClaims(db, 't1', 'X'), []);
    await findBatchClaims(db, 't1', '000000101');
    assert.ok(queries[1]?.sql.includes('"b"."control_number" = $2'));
    assert.ok(queries[1]?.parameters.includes(101));
    await findTracedCoverage(db, 't1', 'ABC');
    assert.ok(queries[2]?.parameters.includes('abc'));
  });

  it('records acknowledgments once per file line and counts problems', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const inserted = await insertAcknowledgment(db, {
      claimId: 'c1',
      coverageId: 'cov1',
      kind: 'rejected',
      note: 'Rejected',
      payerClaimNumber: null,
      sourceKey: 'd:1',
      createdBy: 'u1'
    });
    assert.equal(inserted, false);
    assert.ok(queries[0]?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    await saveFileItems(db, 'f1', [], 0);
    assert.equal(queries.length, 2);
    assert.ok(queries[1]?.sql.startsWith('update "payer_files"'));
  });
});
