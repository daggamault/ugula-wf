import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import {
  buildClaimBalancesView,
  buildClaimBatchesTable,
  buildClaimCoveragesPayerForeignKey,
  buildClaimCoveragesTable,
  buildClaimDiagnosesTable,
  buildClaimEventAdjustmentsTable,
  buildClaimEventsTable,
  buildClaimLinesTable,
  buildClaimRunsTable,
  buildClaimsCycleRunForeignKey,
  buildClaimsIndexes,
  buildClaimsTable
} from './claims.ts';

const flat = (sql: string) => sql.replace(/\s+/g, ' ');

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
    assert.ok(
      claims.includes(
        "trip_type in ('emergency', 'scheduled', 'treatNoTransport', 'refusal', 'noClaim')"
      )
    );
    assert.ok(claims.includes('"number" integer generated always as identity not null unique'));
    assert.ok(claims.includes('"status" text default \'draft\' not null'));
    assert.ok(claims.includes("status in ('draft', 'needs_review', 'ready', 'submitted'"));
    assert.ok(
      claims.includes(
        "status in ('draft', 'void') or (level is not null and emergency is not null and service_date is not null)"
      )
    );
    assert.ok(claims.includes('(origin_code is null) = (destination_code is null)'));
    assert.ok(claims.includes("origin_code in ('R', 'S', 'H', 'N', 'E', 'P', 'D', 'G', 'J', 'I')"));
    assert.ok(
      claims.includes("destination_code in ('R', 'S', 'H', 'N', 'E', 'P', 'D', 'G', 'J', 'I', 'X')")
    );
    assert.ok(claims.includes("pickup_state ~ '^[A-Z]{2}$'"));
    assert.ok(claims.includes('unique ("tenant_id", "source_key")'));
    assert.ok(!claims.includes('jsonb'));
    assert.ok(
      claims.includes(
        'constraint "claims_patient_id_fkey" foreign key ("tenant_id", "patient_id") references "patients" ("tenant_id", "id") on delete no action'
      )
    );
    assert.ok(claims.includes('unique ("tenant_id", "id")'));
    assert.ok(claims.includes("status in ('draft', 'void') or patient_id is not null"));
    assert.ok(
      flat(buildClaimsCycleRunForeignKey().compile(db).sql).includes(
        'foreign key (tenant_id, "cycle_run_id") references "workflow_runs" (tenant_id, id) on delete set null ("cycle_run_id")'
      )
    );
    await db.destroy();
  });

  it('compiles one claim per run so tasks and faults find the claim they are about', async () => {
    const db = createDummyDb();
    const runs = buildClaimRunsTable(db).compile().sql;
    assert.ok(
      runs.includes('"run_id" uuid primary key references "workflow_runs" ("id") on delete cascade')
    );
    assert.ok(
      runs.includes('"claim_id" uuid not null references "claims" ("id") on delete cascade')
    );
    await db.destroy();
  });

  it('compiles ordered charge lines, coverages and diagnoses owned by their claim', async () => {
    const db = createDummyDb();
    const lines = buildClaimLinesTable(db).compile().sql;
    assert.ok(lines.includes('primary key ("claim_id", "position")'));
    assert.ok(lines.includes('"units" numeric(8, 1) not null'));
    assert.ok(lines.includes("code ~ '^[A-Z][0-9]{4}$'"));
    const coverages = buildClaimCoveragesTable(db).compile().sql;
    assert.ok(
      coverages.includes(
        'constraint "claim_coverages_claim_id_fkey" foreign key ("tenant_id", "claim_id") references "claims" ("tenant_id", "id") on delete cascade'
      )
    );
    assert.ok(
      coverages.includes("relationship in ('18', '01', '19', '20', '21', '39', '40', '53', 'G8')")
    );
    assert.ok(
      flat(buildClaimCoveragesPayerForeignKey().compile(db).sql).includes(
        'references "payers" (tenant_id, id) on delete set null ("payer_id")'
      )
    );
    assert.ok(coverages.includes('unique ("claim_id", "position") deferrable initially deferred'));
    const diagnoses = buildClaimDiagnosesTable(db).compile().sql;
    assert.ok(diagnoses.includes('position between 1 and 12'));
    assert.ok(diagnoses.includes('unique ("claim_id", "code")'));
    for (const table of [lines, diagnoses]) {
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
        'constraint "claim_events_coverage_fkey" foreign key ("claim_id", "coverage_id") references "claim_coverages" ("claim_id", "id") on delete no action'
      )
    );
    assert.ok(events.includes('unique ("claim_id", "source_key")'));
    assert.ok(
      events.includes(
        "(kind not in ('submitted', 'resubmitted', 'resubmit_queued', 'follow_up', 'payer_skipped', 'reconciled') or coverage_id is not null)"
      )
    );
    assert.ok(
      events.includes("(kind not in ('statement', 'revised', 'closed') or coverage_id is null)")
    );
    assert.ok(events.includes('references "claim_batches" ("id") on delete no action'));
    assert.ok(
      events.includes(
        "(kind = 'response' and paid_cents >= 0 and adjusted_cents >= 0) or (kind = 'refunded' and paid_cents < 0 and adjusted_cents = 0) or (paid_cents = 0 and adjusted_cents = 0)"
      )
    );
    assert.ok(events.includes('"payer_claim_number" text'));
    assert.ok(events.includes('"paid_on" date'));
    assert.ok(
      events.includes(
        "kind in ('response', 'refunded') or (paid_on is null and check_number is null)"
      )
    );
    await db.destroy();
  });

  it('compiles the reason codes of each payer adjustment, owned by its event', async () => {
    const db = createDummyDb();
    const adjustments = buildClaimEventAdjustmentsTable(db).compile().sql;
    assert.ok(adjustments.includes('references "claim_events" ("id") on delete cascade'));
    assert.ok(adjustments.includes("group_code in ('CO', 'PR', 'OA', 'PI', 'CR')"));
    assert.ok(adjustments.includes("reason_code ~ '^[A-Z0-9]{1,5}$'"));
    assert.ok(adjustments.includes('primary key ("event_id", "position")'));
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
        'create unique index "claim_coverages_claim_payer_name_unique" on "claim_coverages" (claim_id, lower(payer_name), lower(coalesce(member_id, \'\')))'
      )
    );
    assert.ok(
      indexes.includes(
        'create unique index "claims_tenant_pcr_number_unique" on "claims" ("tenant_id", "pcr_number") where "pcr_number" is not null'
      )
    );
    assert.ok(
      indexes.includes(
        'create index "idx_claim_events_kind_created" on "claim_events" ("kind", "created_at")'
      )
    );
    assert.ok(indexes.some((i) => i.includes('"idx_claim_events_coverage_id"')));
    assert.ok(indexes.some((i) => i.includes('"idx_claim_coverages_payer_id"')));
    assert.ok(indexes.some((i) => i.includes("(lower(coalesce(pcr_number, ''))) gin_trgm_ops")));
    assert.ok(indexes.some((i) => i.includes('"idx_claim_runs_claim_id"')));
    assert.equal(indexes.length, 16);
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
