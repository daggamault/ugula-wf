import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findCodes } from './queries.ts';

describe('findCodes', () => {
  it('searches billable codes by code prefix or every word of the description, best first', async () => {
    const { db, queries } = createRecordingDb(() => [
      { code: 'R079', description: 'Chest pain, unspecified', billable: true }
    ]);
    assert.deepEqual(await findCodes(db, { set: 'icd10cm', q: 'r07.9' }), [
      { code: 'R079', description: 'Chest pain, unspecified', billable: true }
    ]);
    await findCodes(db, { set: 'icd10cm', q: 'chest 50%' });
    const [byCode, byWords] = queries;
    assert.equal(
      byCode?.sql,
      'select "c"."code", "c"."description", "c"."billable" from "codes" as "c" where "c"."code_set" = $1 and "c"."billable" = $2 and ("c"."code" like $3 or "c"."description" ilike $4) order by case when c.code like $5 then length(c.code) end, case when c.code like $6 then c.code end, word_similarity($7, c.description) desc, length(c.description), "c"."code" limit $8'
    );
    assert.deepEqual(byCode?.parameters, [
      'icd10cm',
      true,
      'R079%',
      '%r07.9%',
      'R079%',
      'R079%',
      'r07.9',
      50
    ]);
    assert.ok(byWords?.sql.includes('("c"."description" ilike $4 and "c"."description" ilike $5)'));
    assert.deepEqual(byWords?.parameters.slice(3, 5), ['%chest%', '%50\\%%']);
  });

  it('limits a search to a NEMSIS pick list', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findCodes(db, { set: 'snomed', list: 'procedure' });
    assert.ok(
      queries[0]?.sql.includes(
        'exists (select "p"."code" from "nemsis_pick_lists" as "p" where "p"."list" = $3 and "p"."code_set" = "c"."code_set" and "p"."code" = "c"."code")'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['snomed', true, 'procedure', 50]);
  });

  it('describes given codes, billable or not, without a query for none', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await findCodes(db, { set: 'icd10cm', codes: ['r07.9', 'R07'] });
    assert.ok(
      queries[0]?.sql.endsWith(
        'where "c"."code_set" = $1 and "c"."code" in ($2, $3) order by "c"."code"'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['icd10cm', 'R079', 'R07']);
    assert.deepEqual(await findCodes(db, { set: 'icd10cm', codes: [] }), []);
    assert.equal(queries.length, 1);
  });
});
