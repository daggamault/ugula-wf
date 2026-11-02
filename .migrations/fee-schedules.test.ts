import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildFeeSchedulesIndex, buildFeeSchedulesTable } from './fee-schedules.ts';

describe('fee schedules table', () => {
  it('compiles one price per tenant, directory payer (or default) and HCPCS code', async () => {
    const db = createDummyDb();
    const tableSql = buildFeeSchedulesTable(db).compile().sql;
    assert.ok(tableSql.includes('"payer_id" uuid references "payers" ("id") on delete cascade'));
    assert.ok(
      tableSql.includes(
        'constraint "fee_schedules_tenant_payer_code_unique" unique nulls not distinct ("tenant_id", "payer_id", "code")'
      )
    );
    assert.ok(tableSql.includes("check (code ~ '^[A-Z][0-9]{4}$')"));
    assert.ok(tableSql.includes('check (amount_cents >= 0)'));
    assert.equal(
      buildFeeSchedulesIndex(db).compile().sql,
      'create index "idx_fee_schedules_payer_id" on "fee_schedules" ("payer_id")'
    );
    await db.destroy();
  });
});
