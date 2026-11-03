import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import {
  buildBillingProfilesTable,
  buildPayerAliasesIndex,
  buildPayerAliasesTable,
  buildPayerSuggestionsTable,
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
    assert.ok(profile.includes("check (postal_code ~ '^[0-9]{9}$')"));
    assert.ok(profile.includes('"time_zone" text not null'));
    assert.ok(profile.includes('"next_control_number" integer default 1 not null'));
    assert.ok(profile.includes('next_control_number between 1 and 1000000000'));
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
    assert.ok(payers.includes('"embedding" vector(1024)'));
    assert.ok(payers.includes('unique ("tenant_id", "id")'));
    assert.equal(
      buildPayersIndex(db).compile().sql,
      'create unique index "payers_tenant_name_unique" on "payers" (tenant_id, lower(name))'
    );
    await db.destroy();
  });

  it('compiles learned payer aliases unique per tenant and removed with their payer', async () => {
    const db = createDummyDb();
    const aliases = buildPayerAliasesTable(db).compile().sql;
    assert.ok(
      aliases.includes(
        'constraint "payer_aliases_payer_id_fkey" foreign key ("tenant_id", "payer_id") references "payers" ("tenant_id", "id") on delete cascade on update cascade'
      )
    );
    assert.ok(
      aliases.includes(
        'constraint "payer_aliases_tenant_id_alias_key_unique" unique ("tenant_id", "alias_key")'
      )
    );
    assert.ok(aliases.includes("check (alias_key <> '')"));
    assert.equal(
      buildPayerAliasesIndex(db).compile().sql,
      'create index "idx_payer_aliases_payer_id" on "payer_aliases" ("payer_id")'
    );
    await db.destroy();
  });

  it('compiles cached payer suggestions per name and directory version', async () => {
    const db = createDummyDb();
    const cached = buildPayerSuggestionsTable(db).compile().sql;
    assert.ok(
      cached.includes(
        'constraint "payer_suggestions_pkey" primary key ("tenant_id", "name_key", "directory_version")'
      )
    );
    assert.ok(cached.includes('"payer_id" uuid,'));
    assert.ok(cached.includes('references "payers" ("tenant_id", "id") on delete cascade'));
    await db.destroy();
  });
});
