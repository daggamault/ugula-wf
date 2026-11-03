import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildPatientsIndexes, buildPatientsTable } from './patients.ts';

describe('patients table', () => {
  it('compiles tenant patients with idempotent creation and match indexes', async () => {
    const db = createDummyDb();
    const tableSql = buildPatientsTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "patients"'));
    assert.ok(tableSql.includes('"number" integer generated always as identity not null unique'));
    assert.ok(tableSql.includes('"birth_date" date not null'));
    assert.ok(tableSql.includes('unique ("tenant_id", "source_key")'));
    assert.ok(tableSql.includes('unique ("tenant_id", "id")'));
    assert.ok(tableSql.includes("check (gender in ('F', 'M', 'U'))"));
    assert.ok(tableSql.includes("check (state ~ '^[A-Z]{2}$')"));
    assert.ok(tableSql.includes("check (postal_code ~ '^[0-9]{5}([0-9]{4})?$')"));
    assert.deepEqual(
      buildPatientsIndexes(db).map((i) => i.compile().sql),
      [
        'create index "idx_patients_birth_date" on "patients" ("tenant_id", "birth_date")',
        'create index "idx_patients_last_name_key" on "patients" ("tenant_id", "last_name_key")',
        'create index "idx_patients_last_name_trgm" on "patients" using gin (last_name_key gin_trgm_ops)',
        `create index "idx_patients_full_name_trgm" on "patients" using gin ((lower(last_name || ' ' || first_name)) gin_trgm_ops)`,
        'create index "idx_patients_first_name" on "patients" (tenant_id, lower(first_name) text_pattern_ops)'
      ]
    );
    await db.destroy();
  });
});
