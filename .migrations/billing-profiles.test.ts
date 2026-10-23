import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import {
  buildBillingProfilesTable,
  buildPayersIndex,
  buildPayersTable
} from './billing-profiles.ts';

describe('billing profile and payer directory tables', () => {
  it('compiles one validated billing identity per tenant', async () => {
    const db = createDummyDb();
    const profile = buildBillingProfilesTable(db).compile().sql;
    assert.ok(profile.includes('"tenant_id" uuid primary key references "tenants" ("id")'));
    assert.ok(profile.includes("check (npi ~ '^[0-9]{10}$')"));
    assert.ok(profile.includes("check (tax_id ~ '^[0-9]{9}$')"));
    assert.ok(profile.includes('"production" boolean default false not null'));
    assert.ok(profile.includes("submitter_id ~ '^[A-Za-z0-9]{2,15}$'"));
    await db.destroy();
  });

  it('compiles a payer directory unique by name ignoring case', async () => {
    const db = createDummyDb();
    const payers = buildPayersTable(db).compile().sql;
    assert.ok(
      payers.includes(
        "claim_filing in ('MA', 'MB', 'MC', 'CI', 'BL', 'HM', 'WC', 'CH', 'VA', 'OF')"
      )
    );
    assert.equal(
      buildPayersIndex(db).compile().sql,
      'create unique index "payers_tenant_name_unique" on "payers" (tenant_id, lower(name))'
    );
    await db.destroy();
  });
});
