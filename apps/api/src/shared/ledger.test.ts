import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findActivePlan, listLedgerEvents } from './ledger.ts';

const ROW = {
  kind: 'response',
  coverage_id: 'cov1',
  paid_cents: 50_000,
  adjusted_cents: 10_000,
  payer_claim_number: 'PCN1',
  paid_on: '2026-10-20',
  note: 'ICN 1',
  route: 'appeal',
  created_at: new Date('2026-10-21T00:00:00Z'),
  adjustments: [{ group: 'CO', reason: '45', cents: 10_000 }]
};

describe('listLedgerEvents', () => {
  it('reads a claim’s events oldest first with their reason codes in position order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await listLedgerEvents(db, 'c1'), []);
    assert.equal(
      queries[0]?.sql,
      `select "e"."kind", "e"."coverage_id", "e"."paid_cents", "e"."adjusted_cents", "e"."payer_claim_number", "e"."paid_on", "e"."note", "e"."route", "e"."created_at", (select coalesce(json_agg(agg), '[]') from (select "a"."group_code" as "group", "a"."reason_code" as "reason", "a"."amount_cents" as "cents" from "claim_event_adjustments" as "a" where "a"."event_id" = "e"."id" order by "a"."position") as agg) as "adjustments" from "claim_events" as "e" where "e"."claim_id" = $1 order by "e"."created_at", "e"."id"`
    );
    assert.deepEqual(queries[0]?.parameters, ['c1']);
  });

  it('maps each event to the ledger shape with an ISO timestamp', async () => {
    const { db } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await listLedgerEvents(db, 'c1'), [
      {
        kind: 'response',
        coverageId: 'cov1',
        paidCents: 50_000,
        adjustedCents: 10_000,
        payerClaimNumber: 'PCN1',
        paidOn: '2026-10-20',
        adjustments: [{ group: 'CO', reason: '45', cents: 10_000 }],
        note: 'ICN 1',
        route: 'appeal',
        at: '2026-10-21T00:00:00.000Z'
      }
    ]);
  });

  it('reads a timestamp given as text the same way', async () => {
    const { db } = createRecordingDb(() => [
      { ...ROW, created_at: '2026-10-21 02:00:00+02', coverage_id: null, adjustments: [] }
    ]);
    const [event] = await listLedgerEvents(db, 'c1');
    assert.deepEqual(
      [event?.at, event?.coverageId, event?.adjustments],
      ['2026-10-21T00:00:00.000Z', null, []]
    );
  });
});

describe('findActivePlan', () => {
  it("reads the claim's active payment plan in the agency time zone, or none", async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        installment_cents: 5_000,
        interval_days: 30,
        first_due_on: '2026-12-01',
        missed_count: 1,
        created_at: new Date('2026-11-17T10:00:00Z'),
        time_zone: 'America/New_York'
      }
    ]);
    assert.deepEqual(await findActivePlan(db, 'c1'), {
      installmentCents: 5_000,
      intervalDays: 30,
      firstDueOn: '2026-12-01',
      missedCount: 1,
      startedAt: '2026-11-17T10:00:00.000Z',
      timeZone: 'America/New_York'
    });
    assert.equal(
      queries[0]?.sql,
      `select "installment_cents", "interval_days", "first_due_on", "missed_count", "created_at", coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = "payment_plans"."agency_id"), 'UTC') as "time_zone" from "payment_plans" where "claim_id" = $1 and "status" = $2`
    );
    assert.equal(await findActivePlan(createRecordingDb(() => []).db, 'c1'), null);
  });
});
