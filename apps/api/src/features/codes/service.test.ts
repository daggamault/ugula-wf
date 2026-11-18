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

  it('describes NEMSIS codes from the element their kind comes from', async () => {
    const row = { code: '4212007', description: 'Canceled (Prior to Arrival At Scene)' };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(
      await createCodeService({ db }).describeKind({
        kind: 'incidentDisposition',
        codes: ['4212007']
      }),
      { ok: true, value: { codes: [row] } }
    );
    assert.deepEqual(queries[0]?.parameters, ['eDisposition.12', '4212007']);
  });

  it('describes ICD-10 codes as written, with or without the dot', async () => {
    const { db } = createRecordingDb(() => [
      { code: 'R079', description: 'Chest pain, unspecified', is_billable: true }
    ]);
    assert.deepEqual(
      await createCodeService({ db }).describeKind({ kind: 'icd10', codes: ['R07.9', 'Z99.2'] }),
      { ok: true, value: { codes: [{ code: 'R07.9', description: 'Chest pain, unspecified' }] } }
    );
  });

  it('describes billing values from their labels, and nothing for an unknown kind', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const service = createCodeService({ db });
    assert.deepEqual(await service.describeKind({ kind: 'placeCode', codes: ['H', 'Q'] }), {
      ok: true,
      value: { codes: [{ code: 'H', description: 'Hospital' }] }
    });
    assert.deepEqual(await service.describeKind({ kind: 'nothingLikeIt', codes: ['1'] }), {
      ok: true,
      value: { codes: [] }
    });
    assert.equal(queries.length, 0);
  });
});
