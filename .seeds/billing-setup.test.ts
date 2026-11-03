import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_FILING_CODES, submitterIssues } from '@ugula/billing';
import { createDummyDb } from '@ugula/db/testing';
import {
  buildUpsertDemoPayers,
  buildUpsertDemoProfile,
  demoPayers,
  demoProfile
} from './billing-setup.ts';

describe('billing setup seeds', () => {
  it('seeds a valid demo billing identity and payer directory idempotently', async () => {
    assert.deepEqual(
      submitterIssues({
        organizationName: demoProfile.organization_name,
        npi: demoProfile.npi,
        taxId: demoProfile.tax_id,
        addressLine: demoProfile.address_line,
        city: demoProfile.city,
        state: demoProfile.state,
        postalCode: demoProfile.postal_code,
        phone: demoProfile.phone,
        submitterId: demoProfile.submitter_id,
        receiverId: demoProfile.receiver_id,
        receiverName: demoProfile.receiver_name,
        production: demoProfile.production
      }),
      []
    );
    assert.ok(demoPayers.every((p) => Object.hasOwn(CLAIM_FILING_CODES, p.claim_filing)));
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
