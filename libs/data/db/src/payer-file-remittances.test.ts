import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read835 } from '@ugula/billing';
import { build835 } from '@ugula/billing/mock';
import type { RunQueueClient } from '@ugula/run-queue';
import type { Context } from './payer-file-items.ts';
import { postRemittances, readRemittanceLines } from './payer-file-remittances.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

const text = build835(
  [
    {
      claims: [
        { claimNumber: '1001', chargeCents: 1_000, paidCents: 800 },
        { claimNumber: '1002', chargeCents: 1_000, paidCents: 900 }
      ]
    }
  ],
  { createdAt: new Date('2026-11-01T00:00:00Z') }
);

describe('payer file remittances', () => {
  it('numbers claim payments across the file and matches them without writing', async () => {
    const { db, queries } = createRecordingDb(({ sql, parameters }) =>
      sql.startsWith('select "id", "status" from "claims"') && parameters.includes(1002)
        ? [{ id: 'c2', status: 'submitted' }]
        : []
    );
    const lines = await readRemittanceLines(db, 't1', text);
    assert.deepEqual(
      lines.map((l) => [l.position, l.reference, l.claimId]),
      [
        [1, '1001', null],
        [2, '1002', 'c2']
      ]
    );
    assert.ok(queries.every((q) => q.sql.startsWith('select')));
  });

  it('refuses to post a payment the remittance rules decided nothing for', async () => {
    const { db } = createRecordingDb();
    const c: Context = {
      tx: db,
      boss,
      agencyId: 't1',
      userId: null,
      digest: 'd',
      fileName: 'a.835',
      now: new Date(),
      postings: [{ position: 1, route: 'unmatched', message: '', adjustedCents: 0 }]
    };
    await assert.rejects(
      () => postRemittances(c, read835(text)),
      /No posting was decided for claim payment 2/
    );
  });
});
