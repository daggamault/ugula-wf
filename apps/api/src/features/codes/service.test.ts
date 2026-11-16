import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createCodeService } from './service.ts';

describe('createCodeService', () => {
  it('answers the codes it finds', async () => {
    const row = { code: 'R079', description: 'Chest pain, unspecified', is_billable: true };
    const { db } = createRecordingDb(() => [row]);
    assert.deepEqual(await createCodeService({ db }).find({ set: 'icd10cm', q: 'chest' }), {
      ok: true,
      value: { codes: [row] }
    });
  });
});
