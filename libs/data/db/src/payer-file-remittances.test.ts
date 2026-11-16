import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read835 } from '@ugula/billing';
import { build835 } from '@ugula/billing/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { Context } from './payer-file-items.ts';
import { postRemittances, readRemittanceLines } from './payer-file-remittances.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

const text = build835(
  [
    {
      claims: [
        { claimNumber: '20261105-1001', chargeCents: 1_000, paidCents: 800 },
        { claimNumber: '20261105-1002', chargeCents: 1_000, paidCents: 900 }
      ]
    }
  ],
  { createdAt: new Date('2026-11-01T00:00:00Z') }
);

describe('payer file remittances', () => {
  it('numbers claim payments across the file and matches them in two lookups without writing', async () => {
    const { db, queries } = createRecordingDb(({ sql, parameters }) =>
      sql.startsWith('select "id", "number", "status" from "claims"') &&
      parameters.includes('20261105-1002')
        ? [{ id: 'c2', number: '20261105-1002', status: 'submitted' }]
        : []
    );
    const lines = await readRemittanceLines(db, 't1', text);
    assert.deepEqual(
      lines.map((l) => [l.position, l.reference, l.claimId]),
      [
        [1, '20261105-1001', null],
        [2, '20261105-1002', 'c2']
      ]
    );
    assert.ok(queries.every((q) => q.sql.startsWith('select')));
    assert.equal(queries.length, 2);
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
      postings: [
        { position: 1, route: 'unmatched', message: '', adjustedCents: 0, crossover: false }
      ]
    };
    await assert.rejects(
      () => postRemittances(c, read835(text)),
      /No posting was decided for claim payment 2/
    );
  });
});

type Remit = Parameters<typeof postRemittances>[1][number];
type Posting = Context['postings'][number];

const claimPayment = (o: Partial<Remit['claims'][number]> = {}): Remit['claims'][number] => ({
  claimNumber: '20261105-1001',
  status: '1',
  chargeCents: 1_000,
  paidCents: 0,
  patientCents: 0,
  payerClaimNumber: 'PCN-1',
  adjustments: [],
  remarks: [],
  crossoverPayer: null,
  denied: false,
  reversal: false,
  services: [],
  ...o
});

const remitOf = (o: Partial<Remit> = {}): Remit => ({
  payerName: 'Medicare',
  payerId: 'MCR',
  checkNumber: 'CHK-1',
  paidOn: '2026-11-01',
  totalCents: 0,
  providerAdjustments: [],
  claims: [claimPayment()],
  ...o
});

const posting = (o: Partial<Posting> = {}): Posting => ({
  position: 1,
  route: 'reconcile',
  message: '',
  adjustedCents: 0,
  crossover: false,
  ...o
});

const postingDb = ({
  status = 'submitted',
  duplicate = false,
  posted = { paid: 0, adjusted: 0 },
  plbClaim = null as string | null
} = {}) =>
  createRecordingDb(({ sql }) => {
    if (sql.startsWith('select "id", "number", "status" from "claims"'))
      return [{ id: 'c1', number: '20261105-1001', status }];
    if (sql.includes('"dp"."payer_code"'))
      return [
        { claim_id: 'c1', id: 'cov1', payerId: 'MCR' },
        { claim_id: 'c1', id: 'cov2', payerId: 'AET' }
      ];
    if (sql.startsWith('select "coverage_id", "payer_claim_number" from "claim_events"'))
      return [{ coverage_id: 'cov1', payer_claim_number: 'PCN-1' }];
    if (sql.startsWith('select "id", "status", "patient_id" from "claims"'))
      return [{ id: 'c1', status, patient_id: 'p1' }];
    if (sql.startsWith('select "id" from "claim_events"')) return duplicate ? [{ id: 'e0' }] : [];
    if (sql.includes('claim_balances')) return [{ balance_cents: 1_000 }];
    if (sql.includes('coalesce(sum(adjusted_cents), 0)')) return [posted];
    if (sql.includes('from "claim_coverages"'))
      return ['cov1', 'cov2'].map((id) => ({ id, payer: id, has_events: true }));
    if (sql.startsWith('select "e"."claim_id"')) return plbClaim ? [{ claim_id: plbClaim }] : [];
    if (sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    return [];
  });

const contextFor = (
  recording: ReturnType<typeof createRecordingDb>,
  postings: Posting[]
): Context => ({
  tx: recording.db,
  boss,
  agencyId: 't1',
  userId: 'u1',
  digest: 'd',
  fileName: 'a.835',
  now: new Date('2026-11-01T00:00:00Z'),
  postings
});

const insertedOfKind = (queries: { sql: string; parameters: readonly unknown[] }[], kind: string) =>
  queries
    .filter((q) => q.sql.startsWith('insert into "claim_events"') && q.parameters[2] === kind)
    .map((q) => q.parameters);

describe('posting remittances', () => {
  it('posts a denial, logs it under the payer name and forwards the claim to the next payer', async () => {
    const recording = postingDb();
    const items = await postRemittances(
      contextFor(recording, [posting({ route: 'denial', crossover: true, adjustedCents: 100 })]),
      [remitOf({ claims: [claimPayment({ crossoverPayer: 'Aetna' })] })]
    );
    assert.deepEqual(items, [
      {
        reference: '20261105-1001',
        claimId: 'c1',
        outcome: 'posted',
        message: 'Denied',
        paidCents: 0,
        adjustedCents: 100
      }
    ]);
    assert.deepEqual(insertedOfKind(recording.queries, 'denied'), [
      ['t1', 'c1', 'denied', 'cov1', 'denial', 'Denied by Medicare', 'u1', 'd:1:denied']
    ]);
    assert.deepEqual(insertedOfKind(recording.queries, 'crossed_over'), [
      [
        't1',
        'c1',
        'crossed_over',
        'cov2',
        'Medicare forwarded the claim to Aetna; wait for its payment before billing it',
        'u1',
        'd:1:crossed_over'
      ]
    ]);
    const response = insertedOfKind(recording.queries, 'response')[0];
    assert.ok(response?.includes('Denied from Medicare in a.835'));
    assert.ok(response?.includes('d:1'));
  });

  it('keeps the rule message on a denial and names no crossover payer it was not told', async () => {
    const recording = postingDb();
    await postRemittances(
      contextFor(recording, [posting({ route: 'appeal', message: 'Appeal it', crossover: true })]),
      [remitOf({ payerName: null })]
    );
    assert.deepEqual(
      insertedOfKind(recording.queries, 'denied').map((p) => p[5]),
      ['Appeal it']
    );
    assert.deepEqual(
      insertedOfKind(recording.queries, 'crossed_over').map((p) => p[4]),
      ['The payer forwarded the claim; wait for its payment before billing it']
    );
    assert.ok(
      insertedOfKind(recording.queries, 'response')[0]?.includes('Denied from the payer in a.835')
    );
  });

  it('does not forward a claim from its last payer', async () => {
    const recording = postingDb();
    await postRemittances(contextFor(recording, [posting({ crossover: true })]), [
      remitOf({ payerId: 'AET', claims: [claimPayment({ crossoverPayer: 'Aetna' })] })
    ]);
    assert.deepEqual(insertedOfKind(recording.queries, 'crossed_over'), []);
    assert.equal(insertedOfKind(recording.queries, 'response')[0]?.[3], 'cov2');
  });

  it('reports a payment already posted as a duplicate without logging a denial or crossover again', async () => {
    const recording = postingDb({ duplicate: true });
    const items = await postRemittances(
      contextFor(recording, [posting({ route: 'fix', crossover: true, adjustedCents: 50 })]),
      [remitOf()]
    );
    assert.deepEqual(
      items.map((i) => [i.outcome, i.message, i.paidCents, i.adjustedCents]),
      [['duplicate', 'Denied', 0, 50]]
    );
    assert.equal(
      recording.queries.filter((q) => q.sql.startsWith('insert into "claim_events"')).length,
      0
    );
  });

  it('posts a reversal before the payments in the same file and labels it', async () => {
    const recording = postingDb({ posted: { paid: 800, adjusted: 0 } });
    const items = await postRemittances(
      contextFor(recording, [
        posting({ position: 1 }),
        posting({ position: 2, route: 'reversal' })
      ]),
      [
        remitOf({
          claims: [
            claimPayment({ paidCents: 900, payerClaimNumber: 'PCN-2' }),
            claimPayment({ status: '22', paidCents: -800, reversal: true })
          ]
        })
      ]
    );
    assert.deepEqual(
      items.map((i) => [i.outcome, i.message, i.paidCents]),
      [
        ['posted', '', 900],
        ['posted', 'Reversed', -800]
      ]
    );
    assert.deepEqual(
      insertedOfKind(recording.queries, 'response').map((p) =>
        p.find((v) => typeof v === 'string' && v.endsWith('a.835'))
      ),
      ['Reversal from Medicare in a.835', 'Remittance from Medicare in a.835']
    );
  });

  it('sends a payment the claim refuses to review with the reason', async () => {
    const recording = postingDb({ status: 'paid' });
    const items = await postRemittances(contextFor(recording, [posting()]), [remitOf()]);
    assert.deepEqual(
      items.map((i) => [i.outcome, i.claimId, i.message]),
      [['review', 'c1', 'Claim is already closed']]
    );
  });

  it('sends payments the rules route to review or leave unmatched to a person', async () => {
    const recording = postingDb();
    const items = await postRemittances(
      contextFor(recording, [
        posting({ position: 1, route: 'review' }),
        posting({ position: 2, route: 'review', message: 'Check the payer' }),
        posting({ position: 3, route: 'unmatched', message: 'Not ours' })
      ]),
      [remitOf({ payerName: null, claims: [claimPayment(), claimPayment(), claimPayment()] })]
    );
    assert.deepEqual(
      items.map((i) => [i.outcome, i.claimId, i.message]),
      [
        ['review', 'c1', 'The payer is not a payer on this claim; post the payment by hand'],
        ['review', 'c1', 'Check the payer'],
        ['unmatched', 'c1', 'Not ours']
      ]
    );
    assert.equal(insertedOfKind(recording.queries, 'response').length, 0);
  });

  it('lists each non-zero provider adjustment for review, on the claim its reference names', async () => {
    const recording = postingDb({ plbClaim: 'c9' });
    const items = await postRemittances(contextFor(recording, []), [
      remitOf({
        claims: [],
        providerAdjustments: [
          { reason: 'WO', reference: 'PCN-9', cents: 2_500 },
          { reason: 'L6', reference: null, cents: -20 },
          { reason: 'FB', reference: null, cents: 0 }
        ]
      }),
      remitOf({
        payerName: null,
        checkNumber: null,
        claims: [],
        providerAdjustments: [{ reason: '72', reference: null, cents: 100 }]
      })
    ]);
    const plb = (who: string, reason: string, amount: string) =>
      `${who} made a provider-level adjustment (PLB ${reason}) of ${amount} on this payment, such as a recoupment of an earlier payment; post it on the claim it belongs to by hand`;
    assert.deepEqual(
      items.map((i) => [i.reference, i.claimId, i.outcome, i.message]),
      [
        ['PLB WO PCN-9', 'c9', 'review', plb('Medicare', 'WO', '$25.00')],
        ['PLB L6 CHK-1', null, 'review', plb('Medicare', 'L6', '-$0.20')],
        ['PLB 72', null, 'review', plb('The payer', '72', '$1.00')]
      ]
    );
    assert.deepEqual(
      recording.queries
        .filter((q) => q.sql.startsWith('select "e"."claim_id"'))
        .map((q) => q.parameters),
      [['t1', 'PCN-9', 'response', 1]]
    );
  });

  it('finds no claim for a provider adjustment whose reference was never paid', async () => {
    const recording = postingDb();
    const items = await postRemittances(contextFor(recording, []), [
      remitOf({ claims: [], providerAdjustments: [{ reason: 'WO', reference: 'X', cents: 1 }] })
    ]);
    assert.deepEqual(
      items.map((i) => i.claimId),
      [null]
    );
  });
});
