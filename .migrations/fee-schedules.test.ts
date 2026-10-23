import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildFeeSchedulesIndex, buildFeeSchedulesTable } from './fee-schedules.ts';

describe('fee schedules table', () => {
  it('compiles one price per tenant, payer and HCPCS code', async () => {
    const db = createDummyDb();
    const tableSql = buildFeeSchedulesTable(db).compile().sql;
    assert.ok(tableSql.includes('create table "fee_schedules"'));
    assert.equal(
      buildFeeSchedulesIndex(db).compile().sql,
      'create unique index "fee_schedules_tenant_payer_code_unique" on "fee_schedules" (tenant_id, lower(coalesce(payer, \'\')), code)'
    );
    assert.ok(tableSql.includes("check (code ~ '^[A-Z][0-9]{4}$')"));
    assert.ok(tableSql.includes('check (amount_cents >= 0)'));
    await db.destroy();
  });
});
