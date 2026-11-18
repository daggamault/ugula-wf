import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createDiagnosisStore } from './queries.ts';

const embedder = (vectors: number[][]) => {
  const asked: string[][] = [];
  return {
    asked,
    embed: async (texts: string[]) => {
      asked.push(texts);
      return vectors;
    }
  };
};

const SEARCH =
  'select "c"."code", "c"."description", 1 - (c.embedding <=> $1::vector) as "similarity" from "codes" as "c" where "c"."embedding" is not null and "c"."code_set" = $2 and "c"."is_billable" = $3';

describe('createDiagnosisStore', () => {
  it('finds which codes are billable ICD-10-CM codes in one query', async () => {
    const { db, queries } = createRecordingDb(() => [{ code: 'R079', description: 'Chest pain' }]);
    const store = createDiagnosisStore(db, embedder([]));
    assert.deepEqual(await store.findBillable(['R079', 'I21']), [
      { code: 'R079', description: 'Chest pain' }
    ]);
    assert.equal(
      queries[0]?.sql,
      'select "code", "description" from "codes" where "code_set" = $1 and "is_billable" = $2 and "code" in ($3, $4)'
    );
    assert.deepEqual(queries[0]?.parameters, ['icd10cm', true, 'R079', 'I21']);
  });

  it('asks nothing for no codes', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await createDiagnosisStore(db, embedder([])).findBillable([]), []);
    assert.equal(queries.length, 0);
  });

  it('embeds the text and orders billable codes by closeness', async () => {
    const { db, queries } = createRecordingDb(() => [
      { code: 'R079', description: 'Chest pain, unspecified', similarity: '0.8123' },
      { code: 'X', description: 'Far', similarity: '-0.2' }
    ]);
    const e = embedder([[0.5, 0.25]]);
    assert.deepEqual(await createDiagnosisStore(db, e).search('chest pain', 2, false), [
      { code: 'R079', description: 'Chest pain, unspecified', score: 0.812 },
      { code: 'X', description: 'Far', score: 0 }
    ]);
    assert.deepEqual(e.asked, [['chest pain']]);
    assert.equal(queries[0]?.sql, `${SEARCH} order by c.embedding <=> $4::vector limit $5`);
    assert.deepEqual(queries[0]?.parameters, ['[0.5,0.25]', 'icd10cm', true, '[0.5,0.25]', 2]);
  });

  it('keeps to the impressions and symptoms NEMSIS lists when asked', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await createDiagnosisStore(db, embedder([[1]])).search('seizure', 5, true);
    assert.equal(
      queries[0]?.sql,
      `${SEARCH} and exists (select "p"."code" from "nemsis_pick_lists" as "p" where "p"."list" in ($4, $5) and "p"."code_set" = "c"."code_set" and "p"."code" = "c"."code") order by c.embedding <=> $6::vector limit $7`
    );
    assert.deepEqual(queries[0]?.parameters.slice(3, 5), ['impression', 'symptom']);
  });
});
