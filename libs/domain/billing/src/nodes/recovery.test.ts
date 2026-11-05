import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { PDFDocument } from 'pdf-lib';
import { billingStores, memoryClaims, type RecordedEvent, sampleX837 } from '../testing.ts';
import { recoveryNodes } from './recovery.ts';
import type { RecoveryStore } from './stores.ts';

const event = (patch: Partial<RecordedEvent> & Pick<RecordedEvent, 'kind'>): RecordedEvent => ({
  coverageId: 'cov-Medicare',
  key: patch.kind,
  note: '',
  paidCents: 0,
  adjustedCents: 0,
  payerClaimNumber: null,
  paidOn: null,
  adjustments: [],
  at: '2026-02-01T00:00:00.000Z',
  ...patch
});

const setup = () => {
  const claims = memoryClaims({
    coverages: [{ id: 'cov-Medicare', payer: 'Medicare', claimFiling: 'MB' }],
    totalCents: 100_000
  });
  const calls: [string, unknown][] = [];
  const recovery: RecoveryStore = {
    recordRefund: async (_, claimId, key, refund) =>
      void calls.push(['refund', { claimId, key, ...refund }]),
    protectBalance: async (_, __, key, p) => void calls.push(['protect', { key, ...p }]),
    skipRemainingPayers: async (_, __, key, note) => void calls.push(['skip', { key, note }]),
    addPayer: async (_, __, payer) => void calls.push(['add', payer]),
    appealPacket: async () => ({
      agency: {
        name: 'Metro EMS',
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        phone: '2175550100'
      },
      payer: 'Medicare',
      claim: [{ label: 'Claim', value: '20261002-0012' }],
      report: [],
      attachments: []
    }),
    saveAppealPacket: async (_, __, key, packet) => void calls.push(['packet', { key, ...packet }])
  };
  const nodes = recoveryNodes(() => billingStores({ claims: claims.store, recovery }));
  const run = (type: string, inputs: Values) => {
    const node = nodes.find((n) => n.type === `billing.${type}`);
    if (!node) throw new Error(`No node ${type}`);
    return invokeNode(node, { inputs, now: new Date('2026-03-01T00:00:00.000Z') });
  };
  return { claims, calls, run };
};

describe('recoveryNodes', () => {
  it('reads the denial, the appeal outcome, the credit balance and the patient balance', async () => {
    const { claims, run } = setup();
    claims.events.push(
      event({ kind: 'response', adjustments: [{ group: 'CO', reason: '50', cents: 100_000 }] }),
      event({ kind: 'denied', route: 'appeal', note: 'Denied' }),
      event({ kind: 'appealed' })
    );
    const denial = (await run('read-denial', { claimId: 'c1', coverageId: 'cov-Medicare' })).outputs
      .denial as Record<string, unknown>;
    assert.deepEqual([denial.route, denial.codes, denial.appeals], ['appeal', ['CO-50'], 1]);
    const appeal = await run('read-appeal', { claimId: 'c1', coverageId: 'cov-Medicare' });
    assert.deepEqual([appeal.outputs.decided, appeal.outputs.signalsSeen], [false, 0]);
    const refund = (await run('read-refund', { claimId: 'c1' })).outputs.refund as Record<
      string,
      unknown
    >;
    assert.equal(refund.overpaidCents, 0);
    const balance = (await run('read-patient-balance', { claimId: 'c1' })).outputs
      .patientBalance as Record<string, unknown>;
    assert.equal(balance.balanceCents, 100_000);
    await assert.rejects(() => run('read-refund', { claimId: 'other' }), /does not exist/);
  });

  it('reads a payer on the claim, or the patient when none is given', async () => {
    const { run } = setup();
    const medicare = await run('read-payer', { claimId: 'c1', coverageId: 'cov-Medicare' });
    assert.deepEqual(medicare.outputs, { payer: 'Medicare', payerKind: 'MB' });
    const patient = await run('read-payer', { claimId: 'c1', coverageId: null });
    assert.deepEqual(patient.outputs, { payer: null, payerKind: 'patient' });
    await assert.rejects(
      () => run('read-payer', { claimId: 'c1', coverageId: 'cov-Other' }),
      /not on the claim/
    );
  });

  it('records refunds on the agency date, protected balances and skipped payers once per step', async () => {
    const { calls, run } = setup();
    await run('record-refund', { claimId: 'c1', coverageId: 'cov-Medicare', amountCents: 2_500 });
    await run('protect-balance', { claimId: 'c1', adjustedCents: 0, note: 'NH law' });
    await run('protect-balance', { claimId: 'c1', adjustedCents: 4_000, note: 'NH law' });
    await run('skip-remaining-payers', { claimId: 'c1' });
    await run('add-payer', { claimId: 'c1', payerId: 'p-blue', memberId: ' M1 ' });
    assert.deepEqual(
      calls.map(([kind]) => kind),
      ['refund', 'protect', 'skip', 'add']
    );
    assert.deepEqual(calls[0]?.[1], {
      claimId: 'c1',
      key: 'key',
      coverageId: 'cov-Medicare',
      cents: 2_500,
      note: 'Refund of a credit balance',
      paidOn: '2026-02-28'
    });
    assert.deepEqual(calls[3]?.[1], { payerId: 'p-blue', memberId: 'M1' });
    await assert.rejects(
      () => run('add-payer', { claimId: 'c1', payerId: ' ' }),
      /Choose the payer/
    );
    await assert.rejects(
      () => run('record-refund', { claimId: 'c1', amountCents: -1 }),
      /whole number of cents/
    );
  });

  it('renders and stores the appeal packet, and sets another claim frequency', async () => {
    const { calls, run } = setup();
    await run('build-appeal-packet', {
      claimId: 'c1',
      coverageId: 'cov-Medicare',
      level: 'Redetermination',
      dueOn: '2026-06-29T00:00:00.000Z'
    });
    const [kind, saved] = calls[0] ?? [];
    const packet = saved as { note: string; pdf: Uint8Array };
    assert.equal(kind, 'packet');
    assert.equal(packet.note, 'Redetermination packet, due by 2026-06-29');
    assert.equal((await PDFDocument.load(packet.pdf)).getPageCount(), 1);
    const voided = await run('with-frequency', { x837: sampleX837, frequency: '8' });
    assert.equal((voided.outputs.x837 as { frequency: string }).frequency, '8');
  });
});
