import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import {
  buildClaimBalancesView,
  buildClaimBatchesTable,
  buildClaimCoveragesTable,
  buildClaimDiagnosesTable,
  buildClaimEventsTable,
  buildClaimLinesTable,
  buildClaimsIndexes,
  buildClaimsTable
} from './claims.ts';

describe('claims tables', () => {
  it('compiles claims with queryable service details and a link to the source report', async () => {
    const db = createDummyDb();
    const claims = buildClaimsTable(db).compile().sql;
    assert.ok(claims.includes('"service_date" date'));
    assert.ok(claims.includes('"destination_postal_code" text'));
    assert.ok(
      claims.includes(
        '"import_report_id" uuid unique references "import_reports" ("id") on delete set null'
      )
    );
    assert.ok(claims.includes("level in ('BLS', 'ALS1', 'ALS2', 'SCT')"));
    assert.ok(claims.includes('(origin_code is null) = (destination_code is null)'));
    assert.ok(claims.includes("origin_code in ('R', 'S', 'H', 'N', 'E', 'P', 'D', 'G', 'J', 'I')"));
    assert.ok(
      claims.includes("destination_code in ('R', 'S', 'H', 'N', 'E', 'P', 'D', 'G', 'J', 'I', 'X')")
    );
    assert.ok(claims.includes("pickup_state ~ '^[A-Z]{2}$'"));
    assert.ok(claims.includes('unique ("tenant_id", "source_key")'));
    assert.ok(!claims.includes('jsonb'));
    assert.ok(
      claims.includes('"cycle_run_id" uuid references "workflow_runs" ("id") on delete set null')
    );
    await db.destroy();
  });

  it('compiles ordered charge lines, coverages and diagnoses owned by their claim', async () => {
    const db = createDummyDb();
    const lines = buildClaimLinesTable(db).compile().sql;
    assert.ok(lines.includes('primary key ("claim_id", "position")'));
    assert.ok(lines.includes('"units" numeric(8, 2) not null'));
    assert.ok(lines.includes("code ~ '^[A-Z][0-9]{4}$'"));
    const coverages = buildClaimCoveragesTable(db).compile().sql;
    assert.ok(coverages.includes('"payer_id" uuid references "payers" ("id") on delete set null'));
    assert.ok(coverages.includes('unique ("claim_id", "position") deferrable initially deferred'));
    const diagnoses = buildClaimDiagnosesTable(db).compile().sql;
    assert.ok(diagnoses.includes('position between 1 and 12'));
    assert.ok(diagnoses.includes('unique ("claim_id", "code")'));
    for (const table of [lines, coverages, diagnoses]) {
      assert.ok(table.includes('references "claims" ("id") on delete cascade'));
    }
    await db.destroy();
  });

  it('compiles an idempotent event log tied to the coverage each payer event is about', async () => {
    const db = createDummyDb();
    const events = buildClaimEventsTable(db).compile().sql;
    assert.ok(events.includes('references "claims" ("id") on delete cascade'));
    assert.ok(
      events.includes(
        'constraint "claim_events_coverage_fkey" foreign key ("claim_id", "coverage_id") references "claim_coverages" ("claim_id", "id") on delete restrict'
      )
    );
    assert.ok(events.includes('unique ("claim_id", "source_key")'));
    assert.ok(
      events.includes(
        "(kind not in ('submitted', 'resubmitted', 'resubmit_queued', 'follow_up', 'payer_skipped') or coverage_id is not null)"
      )
    );
    assert.ok(
      events.includes("(kind not in ('statement', 'revised', 'closed') or coverage_id is null)")
    );
    assert.ok(events.includes('references "claim_batches" ("id") on delete restrict'));
    await db.destroy();
  });

  it('compiles a balance view that sums each claim ledger per row', async () => {
    const db = createDummyDb();
    const view = buildClaimBalancesView(db).compile().sql;
    assert.ok(view.startsWith('create view "claim_balances" as select'));
    assert.ok(view.includes('inner join lateral'));
    assert.ok(view.includes('c.total_cents - t.paid_cents - t.adjusted_cents'));
    await db.destroy();
  });

  it('indexes reporting dimensions and every foreign key', async () => {
    const db = createDummyDb();
    const indexes = buildClaimsIndexes(db).map((i) => i.compile().sql);
    assert.ok(
      indexes.includes(
        'create index "idx_claims_tenant_service_date" on "claims" ("tenant_id", "service_date")'
      )
    );
    assert.ok(
      indexes.includes(
        'create unique index "claim_coverages_claim_payer_name_unique" on "claim_coverages" (claim_id, lower(payer_name))'
      )
    );
    assert.ok(
      indexes.includes(
        'create unique index "claims_tenant_pcr_number_unique" on "claims" ("tenant_id", "pcr_number") where "pcr_number" is not null'
      )
    );
    assert.ok(indexes.some((i) => i.includes('"idx_claim_events_coverage_id"')));
    assert.ok(indexes.some((i) => i.includes('"idx_claim_coverages_payer_id"')));
    assert.equal(indexes.length, 13);
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
