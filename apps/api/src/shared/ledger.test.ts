import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { listLedgerEvents } from './ledger.ts';

describe('listLedgerEvents', () => {
  it('reads the ledger in order with paid dates and reason codes', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        kind: 'response',
        coverage_id: 'cov1',
        paid_cents: 50_000,
        adjusted_cents: 10_000,
        payer_claim_number: 'PCN1',
        paid_on: '2026-10-20',
        note: 'ICN 1',
        created_at: new Date('2026-10-21T00:00:00Z'),
        adjustments: [{ group: 'CO', reason: '45', cents: 10_000 }]
      }
    ]);
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
        at: '2026-10-21T00:00:00.000Z'
      }
    ]);
    assert.match(queries[0]?.sql ?? '', /from "claim_event_adjustments" as "a"/);
    assert.match(queries[0]?.sql ?? '', /order by "e"."created_at", "e"."id"/);
    assert.deepEqual(queries[0]?.parameters, ['c1']);
  });
});
