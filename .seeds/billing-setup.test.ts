import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { isClaimFilingCode, isValidNpi } from '@ugula/billing';
import { createDummyDb } from '@ugula/db';
import {
  buildUpsertDemoPayers,
  buildUpsertDemoProfile,
  demoPayers,
  demoProfile
} from './billing-setup.ts';

describe('billing setup seeds', () => {
  it('seeds a valid demo billing identity and payer directory idempotently', async () => {
    assert.ok(isValidNpi(demoProfile.npi));
    assert.ok(demoPayers.every((p) => isClaimFilingCode(p.claim_filing)));
    const db = createDummyDb();
    assert.ok(
      buildUpsertDemoProfile(db, 't-1')
        .compile()
        .sql.includes('on conflict ("tenant_id") do update')
    );
    assert.ok(
      buildUpsertDemoPayers(db, 't-1')
        .compile()
        .sql.includes('on conflict (tenant_id, lower(name)) do update')
    );
    await db.destroy();
  });
});
