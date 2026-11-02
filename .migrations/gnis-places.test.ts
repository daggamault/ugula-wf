import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildGnisPlacesTable } from './gnis-places.ts';

describe('buildGnisPlacesTable', () => {
  it('keys places by their GNIS feature id with a two-letter state', async () => {
    const db = createDummyDb();
    const { sql } = buildGnisPlacesTable(db).compile();
    assert.ok(sql.includes('create table "gnis_places"'));
    assert.ok(sql.includes('"id" integer primary key'));
    assert.ok(sql.includes("state ~ '^[A-Z]{2}$'"));
    await db.destroy();
  });
});
