import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { listLedgerEvents } from './ledger.ts';

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
