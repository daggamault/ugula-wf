import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createCodeService } from './service.ts';

describe('createCodeService', () => {
  it('answers the codes it finds', async () => {
    const row = { code: 'R079', description: 'Chest pain, unspecified', is_billable: true };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await createCodeService({ db }).find({ set: 'icd10cm', q: 'chest' }), {
      ok: true,
      value: { codes: [row] }
    });
    assert.equal(queries.length, 1);
  });

  it('answers no codes for an empty list without querying', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await createCodeService({ db }).find({ set: 'icd10cm', codes: [] }), {
      ok: true,
      value: { codes: [] }
    });
    assert.equal(queries.length, 0);
  });
});
