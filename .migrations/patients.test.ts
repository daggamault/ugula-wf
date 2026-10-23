import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildPatientsIndexes, buildPatientsTable } from './patients.ts';

describe('patients table', () => {
  it('compiles tenant patients with idempotent creation and match indexes', async () => {
    const db = createDummyDb();
    const tableSql = buildPatientsTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "patients"'));
    assert.ok(tableSql.includes('"birth_date" date not null'));
    assert.ok(tableSql.includes('unique ("tenant_id", "source_key")'));
    assert.deepEqual(
      buildPatientsIndexes(db).map((i) => i.compile().sql),
      [
        'create index "idx_patients_birth_date" on "patients" ("tenant_id", "birth_date")',
        'create index "idx_patients_last_name_key" on "patients" ("tenant_id", "last_name_key")'
      ]
    );
    await db.destroy();
  });
});
