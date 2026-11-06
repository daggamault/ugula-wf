import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCodes } from './codes.ts';
import { createRecordingDb } from './testing.ts';

describe('codes', () => {
  it('skips the query when there is nothing to describe', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await describeCodes(db, []), {});
    assert.equal(queries.length, 0);
  });

  it('describes each code once, grouped by code set', async () => {
    const { db, queries } = createRecordingDb(() => [
      { code_set: 'hcpcs', code: 'A0427', description: 'ALS1 emergency' },
      { code_set: 'icd10cm', code: 'I214', description: 'NSTEMI' }
    ]);
    const described = await describeCodes(db, [
      { set: 'hcpcs', code: 'A0427' },
      { set: 'hcpcs', code: 'A0427' },
      { set: 'icd10cm', code: 'I214' }
    ]);
    assert.deepEqual(described, {
      hcpcs: { A0427: 'ALS1 emergency' },
      icd10cm: { I214: 'NSTEMI' }
    });
    assert.deepEqual(queries[0]?.parameters, ['hcpcs', 'A0427', 'icd10cm', 'I214']);
  });
});
