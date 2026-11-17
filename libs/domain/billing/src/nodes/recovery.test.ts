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
    const denial = await run('read-denial', { claimId: 'c1', coverageId: 'cov-Medicare' });
    assert.deepEqual(denial.outputs.denial, {
      coverageId: 'cov-Medicare',
      payer: 'Medicare',
      payerKind: 'MB',
      route: 'appeal',
      note: 'Denied',
      codes: ['CO-50'],
      remarks: [],
      paidCents: 0,
      balanceCents: 100_000,
      deniedOn: '2026-02-01',
      appeals: 1,
      payerClaimNumber: null,
      correctionMethod: null,
      appealDays: null
    });
    const appeal = await run('read-appeal', { claimId: 'c1', coverageId: 'cov-Medicare' });
    assert.deepEqual(appeal.outputs, {
      decided: false,
      paidCents: 0,
      deniedAgain: false,
      balanceCents: 100_000,
      signalsSeen: 0
    });
    assert.deepEqual((await run('read-refund', { claimId: 'c1' })).outputs.refund, {
      overpaidCents: 0,
      coverageId: null,
      payer: null,
      payerKind: 'patient',
      paidCents: 0,
      identifiedOn: null
    });
    assert.deepEqual(
      (await run('read-patient-balance', { claimId: 'c1' })).outputs.patientBalance,
      {
        balanceCents: 100_000,
        adjustments: [{ group: 'CO', reason: '50', cents: 100_000 }],
        claimFilings: ['MB'],
        state: null,
        serviceDate: null,
        planType: null,
        payerKind: 'MB',
        protectedCents: 0
      }
    );
    await assert.rejects(() => run('read-refund', { claimId: 'other' }), /does not exist/);
  });

  it('reads what a payer paid and every adjustment it sent across its responses', async () => {
    const { claims, run } = setup();
    claims.events.push(
      event({
        kind: 'response',
        paidCents: 43_000,
        adjustments: [
          { group: 'PR', reason: '2', cents: 11_000 },
          { group: 'CO', reason: '253', cents: 900 }
        ]
      })
    );
    const response = await run('read-payer-response', {
      claimId: 'c1',
      coverageId: 'cov-Medicare'
    });
    assert.deepEqual(response.outputs, {
      paidCents: 43_000,
      adjustments: [
        { group: 'PR', reason: '2', cents: 11_000 },
        { group: 'CO', reason: '253', cents: 900 }
      ]
    });
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
    await run('add-payer', { claimId: 'c1', payerId: 'p-blue', memberId: ' M1 ', groupId: 'G1' });
    assert.deepEqual(calls, [
      [
        'refund',
        {
          claimId: 'c1',
          key: 'key',
          coverageId: 'cov-Medicare',
          cents: 2_500,
          note: 'Refund of a credit balance',
          paidOn: '2026-02-28'
        }
      ],
      ['protect', { key: 'key', adjustedCents: 4_000, note: 'NH law' }],
      ['skip', { key: 'key', note: 'Moved to the patient' }],
      ['add', { payerId: 'p-blue', memberId: 'M1', groupId: 'G1' }]
    ]);
  });

  it('refunds the patient and skips payers with the note given', async () => {
    const { calls, run } = setup();
    await run('record-refund', { claimId: 'c1', amountCents: 500, note: ' Patient overpaid ' });
    await run('skip-remaining-payers', { claimId: 'c1', note: 'Coverage lapsed' });
    await run('add-payer', { claimId: 'c1', payerId: 'p-blue' });
    assert.deepEqual(calls, [
      [
        'refund',
        {
          claimId: 'c1',
          key: 'key',
          coverageId: null,
          cents: 500,
          note: 'Patient overpaid',
          paidOn: '2026-02-28'
        }
      ],
      ['skip', { key: 'key', note: 'Coverage lapsed' }],
      ['add', { payerId: 'p-blue', memberId: null, groupId: null }]
    ]);
  });

  it('refuses a payer, refund or protected balance it cannot record', async () => {
    const { calls, run } = setup();
    await assert.rejects(
      () => run('add-payer', { claimId: 'c1', payerId: ' ' }),
      /Choose the payer to bill/
    );
    await assert.rejects(
      () => run('record-refund', { claimId: 'c1', amountCents: -1 }),
      /The refund .*whole number of cents/
    );
    await assert.rejects(
      () => run('protect-balance', { claimId: 'c1', adjustedCents: 4_000, note: ' ' }),
      /Say why the balance is protected/
    );
    assert.deepEqual(calls, []);
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
    await run('build-appeal-packet', {
      claimId: 'c1',
      coverageId: 'cov-Medicare',
      level: ' Reconsideration '
    });
    assert.equal((calls[1]?.[1] as { note: string } | undefined)?.note, 'Reconsideration packet');
    await assert.rejects(
      () => run('build-appeal-packet', { claimId: 'c1', coverageId: 'cov-Medicare', level: ' ' }),
      /Name the appeal level/
    );
    const voided = await run('with-frequency', { x837: sampleX837, frequency: '8' });
    assert.deepEqual(voided.outputs.x837, { ...sampleX837, frequency: '8' });
    const kept = await run('with-frequency', { x837: sampleX837 });
    assert.deepEqual(kept.outputs.x837, sampleX837);
  });
});
