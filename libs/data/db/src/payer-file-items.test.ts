import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  type Context,
  controlNumberOf,
  findClaimsByNumber,
  item,
  recordPayerEvents,
  unmatchedClaim
} from './payer-file-items.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

describe('payer file items', () => {
  it('reads 837P batch control numbers as positive integers', () => {
    assert.deepEqual(['not a number', '0', '-5', '1.5', ' 1001 '].map(controlNumberOf), [
      null,
      null,
      null,
      null,
      1001
    ]);
  });

  it('finds claims by the daily number billed as CLM01 in one query', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'c1', number: '20261105-0001', status: 'submitted' }
    ]);
    assert.equal((await findClaimsByNumber(db, 't1', ['x', '1001'])).size, 0);
    assert.equal(queries.length, 0);
    const found = await findClaimsByNumber(db, 't1', [
      ' 20261105-0001 ',
      '#202611050002',
      '20261105-0001'
    ]);
    assert.deepEqual(
      queries.map((q) => q.parameters),
      [['t1', '20261105-0001', '20261105-0002']]
    );
    assert.deepEqual(
      [...found],
      [
        [' 20261105-0001 ', { id: 'c1', status: 'submitted' }],
        ['20261105-0001', { id: 'c1', status: 'submitted' }]
      ]
    );
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
    assert.deepEqual(unmatchedClaim('2002'), {
      reference: '2002',
      claimId: null,
      outcome: 'unmatched',
      message: 'No claim has number 2002',
      paidCents: null,
      adjustedCents: null
    });
  });

  it('logs payer events once per file line in one statement and nudges their claims', async () => {
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
    await recordPayerEvents(c, []);
    assert.equal(queries.length, 0);
    const event = { kind: 'rejected', note: 'Rejected', payerClaimNumber: null } as const;
    await recordPayerEvents(c, [
      { ...event, claimId: 'c1', coverageId: 'cov1', key: '1' },
      { ...event, claimId: 'c2', coverageId: 'cov2', key: '2' }
    ]);
    const [insert, signals] = queries;
    assert.ok(insert?.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    assert.ok(insert?.parameters.includes('d:1') && insert.parameters.includes('d:2'));
    assert.ok(insert?.parameters.includes('u1'));
    assert.ok(signals?.sql.startsWith('insert into "signals"'));
    assert.deepEqual(
      signals?.parameters.filter((p) => String(p).startsWith('claim:')),
      ['claim:c1', 'claim:c2']
    );
  });

  it('writes the event fields in order and signals the claim key for the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const c: Context = {
      tx: db,
      boss,
      agencyId: 't1',
      userId: null,
      digest: 'abc',
      fileName: 'a.277',
      now: new Date(),
      postings: []
    };
    await recordPayerEvents(c, [
      {
        claimId: 'c1',
        coverageId: 'cov1',
        kind: 'accepted',
        note: 'Accepted (A1)',
        payerClaimNumber: 'PCN-9',
        key: '3'
      }
    ]);
    assert.deepEqual(
      queries.map((q) => q.sql.split(' ').slice(0, 3).join(' ')),
      ['insert into "claim_events"', 'insert into "signals"', 'select "id", state']
    );
    assert.deepEqual(queries[0]?.parameters, [
      't1',
      'c1',
      'accepted',
      'cov1',
      'Accepted (A1)',
      'PCN-9',
      null,
      'abc:3'
    ]);
    assert.ok(queries[0]?.sql.endsWith('on conflict ("claim_id", "source_key") do nothing'));
    assert.deepEqual(queries[1]?.parameters, ['t1', 'claim:c1', 1]);
    assert.deepEqual(queries[2]?.parameters, ['t1', 'claim:c1', 'suspended']);
  });
});
