import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeCodes } from './codes.ts';
import { createRecordingDb } from './testing.ts';

describe('codes', () => {
  it('skips the query when there is nothing to describe', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await describeCodes(db, []), {});
    assert.equal(queries.length, 0);
    await db.destroy();
  });

  it('describes each code once, grouped by code set', async () => {
    const { db, queries } = createRecordingDb(() => [
      { code_set: 'hcpcs', code: 'A0427', description: 'ALS1 emergency' },
      { code_set: 'hcpcs', code: 'A0425', description: 'Ground mileage' },
      { code_set: 'icd10cm', code: 'I214', description: 'NSTEMI' }
    ]);
    const described = await describeCodes(db, [
      { set: 'hcpcs', code: 'A0427' },
      { set: 'hcpcs', code: 'A0425' },
      { set: 'hcpcs', code: 'A0427' },
      { set: 'icd10cm', code: 'I214' }
    ]);
    assert.deepEqual(described, {
      hcpcs: { A0427: 'ALS1 emergency', A0425: 'Ground mileage' },
      icd10cm: { I214: 'NSTEMI' }
    });
    assert.equal(queries.length, 1);
    assert.equal(
      queries[0]?.sql,
      'select "code_set", "code", "description" from "codes" where ("code_set", "code") in (($1, $2), ($3, $4), ($5, $6))'
    );
    assert.deepEqual(queries[0]?.parameters, [
      'hcpcs',
      'A0427',
      'hcpcs',
      'A0425',
      'icd10cm',
      'I214'
    ]);
    await db.destroy();
  });

  it('describes nothing for codes the set does not know', async () => {
    const { db } = createRecordingDb(() => []);
    assert.deepEqual(await describeCodes(db, [{ set: 'hcpcs', code: 'X9999' }]), {});
    await db.destroy();
  });
});
