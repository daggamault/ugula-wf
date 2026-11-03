import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NodeDef, Values } from '@ugula/graph';
import { invokeNode } from '@ugula/graph/testing';
import { PDFDocument } from 'pdf-lib';
import {
  billingStores,
  completeCheck,
  type MemoryClaimOptions,
  memoryClaims,
  type RecordedEvent
} from '../testing.ts';
import { cycleNodes } from './cycle.ts';

const run = (node: NodeDef, inputs: Values) =>
  invokeNode(node, { inputs, now: new Date('2026-01-01T00:00:00.000Z') });

const event = (kind: RecordedEvent['kind'], coverageId: string | null, at: string) => ({
  kind,
  coverageId,
  key: kind,
  note: '',
  paidCents: 0,
  adjustedCents: 0,
  payerClaimNumber: null,
  paidOn: null,
  adjustments: [],
  at
});

const agency = {
  name: 'Development EMS',
  addressLine: null,
  city: null,
  state: null,
  postalCode: null,
  phone: '2175550100',
  timeZone: 'America/Chicago'
};

const statement = {
  agency,
  patient: {
    name: 'Jane Doe',
    addressLine: '1 Main St',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62701'
  },
  reference: 'PCR-1',
  serviceDate: '2025-12-30',
  lines: [],
  totalCents: 100_000,
  payments: [],
  balanceCents: 100_000
};

const world = (options: MemoryClaimOptions = {}) => {
  const claims = memoryClaims({
    coverages: [
      { id: 'cov-Medicare', payer: 'Medicare' },
      { id: 'cov-Blue', payer: 'Blue' }
    ],
    totalCents: 100_000,
    signalsSeen: 3,
    reference: 'PCR-1 · Jane Doe',
    statement,
    check: completeCheck(),
    ...options
  });
  const nodes = cycleNodes(() => billingStores({ claims: claims.store }));
  const node = (type: string) => {
    const found = nodes.find((n) => n.type === `billing.${type}`);
    if (!found) throw new Error(`No ${type} node`);
    return found;
  };
  return { claims, node };
};

describe('cycleNodes', () => {
  it('walks a claim through its payer cycle and closes it', async () => {
    const { claims, node } = world();
    const [attach, step, record, close, issue] = [
      'attach-cycle',
      'claim-step',
      'record-claim-event',
      'close-claim',
      'issue-statement'
    ].map(node);
    if (!attach || !step || !record || !close || !issue) throw new Error('Missing cycle nodes');

    await run(attach, { claimId: 'c1', cycleRunId: 'run-9' });
    assert.deepEqual(claims.attached, ['run-9']);
    await assert.rejects(
      async () => run(attach, { claimId: 'c1', cycleRunId: ' ' }),
      /No cycle run/
    );

    const next = async (inputs: Values = {}) => run(step, { claimId: 'c1', ...inputs });
    assert.equal((await next()).pin, 'review');
    await run(record, { claimId: 'c1', kind: 'approved', coverageId: 'cov-Blue' });
    assert.equal(claims.events.length, 0);
    await run(record, { claimId: 'c1', kind: 'approved', coverageId: 'cov-Medicare' });
    const submit = await next();
    assert.deepEqual(
      [submit.pin, submit.outputs],
      [
        'submit',
        {
          coverageId: 'cov-Medicare',
          payer: 'Medicare',
          statementNumber: null,
          statementCount: 3,
          balanceCents: 100_000,
          waitMs: 3 * 86_400_000,
          signalsSeen: 3,
          reference: 'PCR-1 · Jane Doe',
          issues: [],
          claim: completeCheck()
        }
      ]
    );
    await run(record, { claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.at(-1)?.kind, 'submitted');
    await run(record, { claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.filter((e) => e.kind === 'submitted').length, 1);
    assert.equal((await next()).pin, 'await');
    assert.equal((await next({ payerWaitDays: 2 })).outputs.waitMs, 2 * 86_400_000);
    await run(record, {
      claimId: 'c1',
      kind: 'resubmit_queued',
      coverageId: 'cov-Medicare',
      payerClaimNumber: ' MCR-9 '
    });
    assert.equal(claims.events.at(-1)?.payerClaimNumber, 'MCR-9');
    claims.events.push(event('submitted', 'cov-Medicare', '2026-01-01T00:00:00.000Z'));
    await run(record, { claimId: 'c1', kind: 'payer_skipped', coverageId: 'cov-Medicare' });
    const before = claims.events.length;
    await run(record, { claimId: 'c1', kind: 'follow_up', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.length, before);
    await run(record, { claimId: 'c1', kind: 'payer_skipped', coverageId: 'cov-Blue' });
    assert.equal((await next()).pin, 'reviewPatient');
    await run(record, { claimId: 'c1', kind: 'payer_skipped' });
    assert.equal(claims.events.at(-1)?.kind, 'payer_skipped');
    assert.equal(claims.events.at(-1)?.coverageId, 'cov-Blue');
    await run(record, { claimId: 'c1', kind: 'approved' });
    assert.equal((await next()).outputs.statementNumber, 1);
    claims.events.push(event('statement', null, '2025-01-01T00:00:00.000Z'));
    assert.equal((await next({ statementCount: 1 })).pin, 'collections');
    await assert.rejects(
      async () => run(record, { claimId: 'c1', kind: 'paid' }),
      /Unknown claim event/
    );
    await assert.rejects(
      async () => run(issue, { claimId: 'c1', statementNumber: 0, statementCount: 3 }),
      /not one of the 3/
    );
    const issued = await run(issue, { claimId: 'c1', statementNumber: 2, statementCount: 5 });
    assert.equal(issued.pin, 'issued');
    const [sent] = claims.statements;
    assert.deepEqual([sent?.number, sent?.count], [2, 5]);
    const pdf = await PDFDocument.load(sent?.pdf ?? new Uint8Array());
    assert.equal(pdf.getTitle(), 'Statement 2 of 5 - Jane Doe');
    assert.equal(pdf.getCreationDate()?.toISOString(), '2025-12-31T00:00:00.000Z');
    await run(close, { claimId: 'c1', status: 'written_off' });
    await run(close, { claimId: 'c1', status: 'void' });
    assert.deepEqual(claims.closed, ['written_off', 'void']);
    assert.deepEqual(claims.statuses, [
      'needs_review',
      'ready',
      'submitted',
      'submitted',
      'needs_review',
      'patient_balance',
      'balance_review'
    ]);
    await assert.rejects(
      async () => run(close, { claimId: 'c1', status: 'gone' }),
      /Unknown claim status/
    );
    await assert.rejects(async () => run(step, { claimId: 'c9' }), /does not exist/);
  });

  it('sends a claim to be fixed before review when its checks block it, ignoring skipped payers', async () => {
    const check = completeCheck();
    const { claims, node } = world({
      check: { ...check, details: { ...check.details, serviceDate: null } }
    });
    const step = node('claim-step');
    const fix = await run(step, { claimId: 'c1' });
    assert.equal(fix.pin, 'fix');
    assert.deepEqual(
      (fix.outputs.issues as { field: string }[]).map((i) => i.field),
      ['serviceDate']
    );
    const unlinked = world({
      check: { ...check, payers: check.payers.map((p) => ({ ...p, payerId: null })) }
    });
    assert.equal((await run(unlinked.node('claim-step'), { claimId: 'c1' })).pin, 'fix');
    unlinked.claims.events.push(event('payer_skipped', 'cov-Medicare', '2026-01-01T00:00:00Z'));
    unlinked.claims.events.push(event('payer_skipped', 'cov-Blue', '2026-01-01T00:00:00Z'));
    assert.equal((await run(unlinked.node('claim-step'), { claimId: 'c1' })).pin, 'reviewPatient');
    assert.deepEqual(claims.statuses, ['needs_review']);
  });

  it('decides again when the claim changed while it decided', async () => {
    const { node } = world({ stale: true });
    assert.equal((await run(node('claim-step'), { claimId: 'c1' })).pin, 'stale');
  });

  it('asks for what a statement is missing instead of faulting', async () => {
    const noProfile = world({ statement: { ...statement, agency: null } });
    const issue = noProfile.node('issue-statement');
    const missing = await run(issue, { claimId: 'c1', statementNumber: 1, statementCount: 3 });
    assert.deepEqual([missing.pin, missing.outputs.need], ['missing', 'profile']);
    const noAddress = world({
      statement: { ...statement, patient: { ...statement.patient, postalCode: null } }
    });
    const unaddressed = await run(noAddress.node('issue-statement'), {
      claimId: 'c1',
      statementNumber: 1,
      statementCount: 3
    });
    assert.deepEqual([unaddressed.pin, unaddressed.outputs.need], ['missing', 'patientAddress']);
    assert.equal(noAddress.claims.statements.length, 0);
  });

  it('lets a reconciled denial be corrected and resubmitted to the payer that denied it', async () => {
    const { claims, node } = world();
    claims.events.push(event('submitted', 'cov-Medicare', '2025-12-01T00:00:00Z'));
    claims.events.push(event('response', 'cov-Medicare', '2025-12-20T00:00:00Z'));
    const record = node('record-claim-event');
    assert.equal((await run(node('claim-step'), { claimId: 'c1' })).pin, 'reconcile');
    await run(record, { claimId: 'c1', kind: 'resubmit_queued', coverageId: 'cov-Medicare' });
    const review = await run(node('claim-step'), { claimId: 'c1' });
    assert.deepEqual([review.pin, review.outputs.coverageId], ['review', 'cov-Medicare']);
  });
});
