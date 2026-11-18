import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build837 } from '@ugula/billing';
import {
  respondToClaims,
  sampleEnvelope,
  sampleRejectedX837,
  sampleSubmitter,
  sampleX837
} from '@ugula/billing/testing';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createClearinghouseStore } from './queries.ts';

const FILE = '0195f2a4-0000-7000-8000-0000000000f1';

const CLAIM = '0195f2a4-0000-7000-8000-000000000001';

const PAYMENT = '0195f2a4-0000-7000-8000-0000000000c1';

const answer = respondToClaims(
  build837(
    { ...sampleSubmitter, receiverId: 'WAYSTAR' },
    [sampleX837, sampleRejectedX837],
    sampleEnvelope
  ),
  new Date('2026-11-03T12:00:00Z')
);

type Rows = (q: CompiledQuery) => unknown[] | undefined;

const setup = (kind: string, content: string, rows: Rows = () => undefined) => {
  const { db, queries } = createRecordingDb((q) => {
    const custom = rows(q);
    if (custom) return custom;
    if (q.sql.startsWith('select "agency_id" from "workflow_runs"')) return [{ agency_id: 't-1' }];
    if (q.sql.startsWith('select "kind", "content", "received_at"')) {
      return [{ kind, content, received_at: '2026-11-03T12:00:00Z' }];
    }
    return [];
  });
  return { store: createClearinghouseStore(db), queries };
};

const sqlOf = (queries: CompiledQuery[], start: string) =>
  queries.filter((q) => q.sql.startsWith(start));

describe('applying acknowledgments', () => {
  it('marks a file the 999 accepted, and leaves its payer waiting', async () => {
    const { store, queries } = setup('999', answer.ack999, (q) =>
      q.sql.startsWith('update "claim_submissions"')
        ? [{ claim_id: CLAIM, coverage_position: 1 }]
        : undefined
    );
    assert.deepEqual(await store.applyAcknowledgments('r1', FILE), { accepted: 1, rejected: 0 });
    const [ack] = sqlOf(queries, 'update "claim_submissions"');
    assert.deepEqual(ack?.parameters.slice(0, 2), ['accepted', null]);
    assert.ok(ack?.parameters.includes(42));
    assert.match(ack?.sql ?? '', /"ack_status" is null returning/);
    assert.equal(sqlOf(queries, 'update "claim_coverages"').length, 0);
  });

  it('marks the payer of a rejected file Rejected with why, and the claim with it', async () => {
    const rejected = answer.ack999.replace('AK9*A', 'AK9*R');
    const { store, queries } = setup('999', rejected, (q) =>
      q.sql.startsWith('update "claim_submissions"')
        ? [{ claim_id: CLAIM, coverage_position: 2 }]
        : q.sql.startsWith('update "claim_coverages"')
          ? [{ id: 'cov-2' }]
          : undefined
    );
    assert.deepEqual(await store.applyAcknowledgments('r1', FILE), { accepted: 0, rejected: 1 });
    const [payer] = sqlOf(queries, 'update "claim_coverages"');
    assert.equal(payer?.parameters[0], 'rejected');
    assert.match(String(payer?.parameters[1]), /^The clearinghouse rejected the 837P/);
    assert.deepEqual(payer?.parameters.slice(-4), [CLAIM, 2, 'sent', 'accepted']);
    const [claim] = sqlOf(queries, 'update "claims"');
    assert.deepEqual(claim?.parameters, ['rejected', CLAIM, 'submitted']);
  });

  it('records the payer claim number a 277CA accepts with, and rejects the claim it rejects', async () => {
    const { store, queries } = setup('277ca', answer.ack277 ?? '', (q) =>
      q.sql.startsWith('select "id" from "claims"')
        ? [{ id: q.parameters[1] === 'c-1' ? CLAIM : 'other' }]
        : q.sql.startsWith('select "position", "payer_claim_number"')
          ? [{ position: 1, payer_claim_number: null }]
          : q.sql.startsWith('update "claim_coverages" set "status" = $1, "status_note"')
            ? [{ id: 'cov' }]
            : undefined
    );
    assert.deepEqual(await store.applyAcknowledgments('r1', FILE), { accepted: 1, rejected: 1 });
    const updates = sqlOf(queries, 'update "claim_coverages"');
    assert.deepEqual(updates[0]?.parameters.slice(0, 3), ['accepted', 'MOCK-c-1', null]);
    assert.equal(updates[1]?.parameters[0], 'rejected');
    assert.match(String(updates[1]?.parameters[1]), /Invalid member ID/);
  });

  it('refuses a file of another agency', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"') ? [{ agency_id: 't-1' }] : []
    );
    await assert.rejects(
      createClearinghouseStore(db).applyAcknowledgments('r1', FILE),
      /Clearinghouse file .* does not exist/
    );
  });
});

describe('posting a remittance', () => {
  const posting = (claims: Record<string, string>) =>
    setup('835', answer.remit835 ?? '', (q) =>
      q.sql.startsWith('select "id" from "remittances"')
        ? []
        : q.sql.startsWith('insert into "remittances"')
          ? [{ id: 'rem-1' }]
          : q.sql.startsWith('select "id" from "claims"')
            ? claims[String(q.parameters[1])]
              ? [{ id: claims[String(q.parameters[1])] }]
              : []
            : q.sql.startsWith('select "position", "payer_claim_number"')
              ? [{ position: 1, payer_claim_number: 'MOCK-c-1' }]
              : undefined
    );

  it('posts what the payer paid on the payer waiting, and saves the payment', async () => {
    const { store, queries } = posting({ 'c-1': CLAIM });
    assert.deepEqual(await store.postRemittance('r1', FILE), {
      remittances: 1,
      posted: 1,
      unmatched: 0
    });
    const [remit] = sqlOf(queries, 'insert into "remittances"');
    assert.ok(remit?.parameters.includes(67_860));
    assert.ok(remit?.parameters.includes(true));
    const [payer] = sqlOf(queries, 'update "claim_coverages"');
    assert.equal(payer?.parameters[0], 'paid');
    const adjudication = JSON.parse(String(payer?.parameters[1]));
    assert.deepEqual([adjudication.paidCents, adjudication.lines.length], [67_860, 2]);
    const [payment] = sqlOf(queries, 'insert into "claim_payments"');
    assert.deepEqual(payment?.parameters.slice(0, 7), [
      't-1',
      'rem-1',
      CLAIM,
      1,
      'c-1',
      '1',
      'paid'
    ]);
    assert.ok(payment?.parameters.includes(16_965));
  });

  it('keeps a payment for a claim it cannot find for a person to match', async () => {
    const { store, queries } = posting({});
    assert.deepEqual(await store.postRemittance('r1', FILE), {
      remittances: 1,
      posted: 0,
      unmatched: 1
    });
    const [payment] = sqlOf(queries, 'insert into "claim_payments"');
    assert.deepEqual(payment?.parameters.slice(2, 5), [null, null, 'c-1']);
    const [count] = sqlOf(queries, 'update "remittances"');
    assert.deepEqual(count?.parameters, [1, 'rem-1']);
    assert.equal(sqlOf(queries, 'update "claim_coverages"').length, 0);
  });

  it('posts a file once', async () => {
    const { store, queries } = setup('835', answer.remit835 ?? '', (q) =>
      q.sql.startsWith('select "id" from "remittances"') ? [{ id: 'rem-1' }] : undefined
    );
    assert.deepEqual(await store.postRemittance('r1', FILE), {
      remittances: 0,
      posted: 0,
      unmatched: 0
    });
    assert.equal(sqlOf(queries, 'insert').length, 0);
  });

  it('refuses a file that is not an 835', async () => {
    await assert.rejects(
      setup('999', answer.ack999).store.postRemittance('r1', FILE),
      /not an 835/
    );
  });
});

describe('reading payments and remittances', () => {
  it('reads a payment with its reasons in words', async () => {
    const { store } = setup('835', '', (q) =>
      q.sql.startsWith('select "p"."claim_id"')
        ? [
            {
              claim_id: CLAIM,
              claim_number: '20261001-0012',
              outcome: 'paid',
              paid_cents: 6_000,
              patient_cents: 1_500,
              adjustments: [{ group: 'PR', reason: '2', cents: 1_500 }],
              remarks: ['N130'],
              has_next_payer: true
            }
          ]
        : q.sql.includes('from "codes"')
          ? [{ code_set: 'carc', code: '2', description: 'Coinsurance Amount' }]
          : undefined
    );
    assert.deepEqual(await store.findPayment('r1', PAYMENT), {
      claimId: CLAIM,
      claimNumber: '20261001-0012',
      outcome: 'paid',
      paidCents: 6_000,
      patientCents: 1_500,
      hasNextPayer: true,
      reasons: ['PR-2 $15.00: Coinsurance Amount', 'N130']
    });
    assert.equal(await store.findPayment('r1', 'p-1'), null);
  });

  it('reads a remittance, and reconciles it by a biller or by itself', async () => {
    const { store, queries } = setup('835', '', (q) =>
      q.sql.startsWith('select "payer_name"')
        ? [
            {
              payer_name: 'MEDICARE',
              total_cents: 6_000,
              is_balanced: false,
              unmatched_count: 2,
              reconciled_at: null
            }
          ]
        : undefined
    );
    assert.deepEqual(await store.findRemittance('r1', PAYMENT), {
      payerName: 'MEDICARE',
      totalCents: 6_000,
      balanced: false,
      unmatched: 2,
      reconciled: false
    });
    await store.reconcileRemittance('r1', PAYMENT, null, null);
    const [update] = sqlOf(queries, 'update "remittances"');
    assert.match(update?.sql ?? '', /"reconciled_at" = now\(\)/);
    await assert.rejects(store.reconcileRemittance('r1', PAYMENT, 'u-1', null), /User u-1/);
  });
});
