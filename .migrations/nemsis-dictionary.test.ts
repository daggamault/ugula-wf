import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildNemsisCodesTable, buildNemsisElementsTable } from './nemsis-dictionary.ts';

describe('NEMSIS dictionary tables', () => {
  it('keys elements by number and codes by list and code', async () => {
    const db = createDummyDb();
    const elements = buildNemsisElementsTable(db).compile().sql;
    assert.ok(elements.includes('create table "nemsis_elements"'));
    assert.ok(elements.includes('"element" text primary key'));
    const codes = buildNemsisCodesTable(db).compile().sql;
    assert.ok(codes.includes('create table "nemsis_codes"'));
    assert.ok(codes.includes('constraint "nemsis_codes_pkey" primary key ("list", "code")'));
    await db.destroy();
  });
});
