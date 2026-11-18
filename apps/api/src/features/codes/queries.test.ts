import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { describeNemsisCodes, searchCodes } from './queries.ts';

const SELECT = 'select "c"."code", "c"."description", "c"."is_billable" from "codes" as "c"';

const BEST_FIRST =
  'order by case when c.code like $6 then length(c.code) end, ' +
  'case when c.code like $7 then c.code end, word_similarity($8, c.description) desc, ' +
  'length(c.description), "c"."code" limit $9';

describe('searchCodes', () => {
  it('searches billable codes by code prefix or the description, best first', async () => {
    const row = { code: 'R079', description: 'Chest pain, unspecified', is_billable: true };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await searchCodes(db, { set: 'icd10cm', q: 'r07.9' }), [row]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${SELECT} where "c"."code_set" = $1 and "c"."is_billable" = $2 and ` +
            '("c"."code" like $3 or "c"."description" ilike $4) order by ' +
            'case when c.code like $5 then length(c.code) end, ' +
            'case when c.code like $6 then c.code end, word_similarity($7, c.description) desc, ' +
            'length(c.description), "c"."code" limit $8',
          ['icd10cm', true, 'R079%', '%r07.9%', 'R079%', 'R079%', 'r07.9', 50]
        ]
      ]
    );
  });

  it('requires every escaped word of the description', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchCodes(db, { set: 'icd10cm', q: 'Chest  50%' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${SELECT} where "c"."code_set" = $1 and "c"."is_billable" = $2 and ` +
            '("c"."code" like $3 or ("c"."description" ilike $4 and "c"."description" ilike $5)) ' +
            BEST_FIRST,
          [
            'icd10cm',
            true,
            'CHEST  50\\%%',
            '%chest%',
            '%50\\%%',
            'CHEST  50\\%%',
            'CHEST  50\\%%',
            'Chest  50%',
            50
          ]
        ]
      ]
    );
  });

  it('lists billable codes in code order without search text', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await searchCodes(db, { set: 'hcpcs' }), []);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${SELECT} where "c"."code_set" = $1 and "c"."is_billable" = $2 order by "c"."code" limit $3`,
          ['hcpcs', true, 50]
        ]
      ]
    );
  });

  it('limits a search to a NEMSIS pick list', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchCodes(db, { set: 'snomed', list: 'procedure', q: 'x' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${SELECT} where "c"."code_set" = $1 and "c"."is_billable" = $2 and exists ` +
            '(select "p"."code" from "nemsis_pick_lists" as "p" where "p"."list" = $3 and ' +
            '"p"."code_set" = "c"."code_set" and "p"."code" = "c"."code") and ' +
            `("c"."code" like $4 or "c"."description" ilike $5) ${BEST_FIRST}`,
          ['snomed', true, 'procedure', 'X%', '%x%', 'X%', 'X%', 'x', 50]
        ]
      ]
    );
  });

  it('describes given codes, billable or not, normalized and in code order', async () => {
    const row = { code: 'R07', description: 'Pain in throat and chest', is_billable: false };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await searchCodes(db, { set: 'icd10cm', codes: ['r07.9', 'R07'] }), [row]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `${SELECT} where "c"."code_set" = $1 and "c"."code" in ($2, $3) order by "c"."code"`,
          ['icd10cm', 'R079', 'R07']
        ]
      ]
    );
  });

  it('describes no codes without a query for an empty list', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await searchCodes(db, { set: 'icd10cm', codes: [], q: 'chest' }), []);
    assert.equal(queries.length, 0);
  });
});

describe('describeNemsisCodes', () => {
  it('describes the codes of one NEMSIS element in one query', async () => {
    const row = { code: '4212007', description: 'Canceled (Prior to Arrival At Scene)' };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await describeNemsisCodes(db, 'eDisposition.12', ['4212007']), [row]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "code", "description" from "nemsis_codes" where "list" = $1 and "code" in ($2) order by "code"',
          ['eDisposition.12', '4212007']
        ]
      ]
    );
  });

  it('asks nothing for no codes', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await describeNemsisCodes(db, 'eDisposition.12', []), []);
    assert.equal(queries.length, 0);
  });
});
