import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  type Context,
  claimNumberOf,
  findClaimByNumber,
  item,
  noClaim,
  recordPayerEvent
} from './payer-file-items.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

describe('payer file items', () => {
  it('reads claim numbers billed as CLM01 and finds their claims', async () => {
    assert.deepEqual(['not a number', '0', '-5', '1.5', ' 1001 '].map(claimNumberOf), [
      null,
      null,
      null,
      null,
      1001
    ]);
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findClaimByNumber(db, 't1', 'x'), undefined);
    assert.equal(queries.length, 0);
    await findClaimByNumber(db, 't1', ' 1001 ');
    assert.deepEqual(queries[0]?.parameters, ['t1', 1001]);
  });

  it('builds file lines, with amounts only when posted', () => {
    assert.deepEqual(item('1001', 'c1', 'posted', '', { paidCents: 5, adjustedCents: 1 }), {
      reference: '1001',
      claimId: 'c1',
      outcome: 'posted',
      message: '',
      paidCents: 5,
      adjustedCents: 1
    });
    assert.deepEqual(noClaim('2002'), {
      reference: '2002',
      claimId: null,
      outcome: 'unmatched',
      message: 'No claim has number 2002',
      paidCents: null,
      adjustedCents: null
    });
  });

  it('logs a payer event once per file line and nudges the claim', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const c: Context = {
      tx: db,
      boss,
      agencyId: 't1',
      userId: 'u1',
      digest: 'd',
      fileName: 'a.999',
      now: new Date(),
      postings: []
    };
    await recordPayerEvent(c, 'c1', 'cov1', {
      kind: 'rejected',
      note: 'Rejected',
      payerClaimNumber: null,
      key: '1'
    });
    const event = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(event?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    assert.ok(event?.parameters.includes('d:1') && event.parameters.includes('u1'));
    assert.ok(queries.some((q) => q.sql.startsWith('insert into "signals"')));
  });
});
