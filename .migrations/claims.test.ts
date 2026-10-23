import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import {
  buildClaimBatchesTable,
  buildClaimEventsTable,
  buildClaimsIndexes,
  buildClaimsTable
} from './claims.ts';

describe('claims tables', () => {
  it('compiles claims with ordered payers and an idempotent event log', async () => {
    const db = createDummyDb();
    const claims = buildClaimsTable(db).compile().sql;
    assert.ok(claims.includes('"payers" text[] default \'{}\' not null'));
    assert.ok(claims.includes('unique ("tenant_id", "source_key")'));
    assert.ok(claims.includes("status in ('open', 'paid', 'written_off', 'collections')"));
    const events = buildClaimEventsTable(db).compile().sql;
    assert.ok(events.includes('references "claims" ("id") on delete cascade'));
    assert.ok(events.includes('unique ("claim_id", "source_key")'));
    assert.ok(events.includes("'payer_skipped'"));
    assert.ok(events.includes("'resubmit_queued'"));
    assert.ok(events.includes('references "claim_batches" ("id") on delete restrict'));
    assert.ok(
      claims.includes('"cycle_run_id" uuid references "workflow_runs" ("id") on delete set null')
    );
    assert.equal(buildClaimsIndexes(db).length, 8);
    await db.destroy();
  });

  it('compiles 837P batches numbered per tenant within the X12 control range', async () => {
    const db = createDummyDb();
    const batches = buildClaimBatchesTable(db).compile().sql;
    assert.ok(batches.includes('unique ("tenant_id", "control_number")'));
    assert.ok(batches.includes('control_number between 1 and 999999999'));
    await db.destroy();
  });
});
