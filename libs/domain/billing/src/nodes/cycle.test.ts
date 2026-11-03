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
  type RecordedEvent,
  sampleSubmitter,
  sampleX837
} from '../testing.ts';
import type { PendingSubmission } from '../x837.ts';
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

const pending: PendingSubmission = {
  id: 'c1',
  claim: {
    claimId: '1001',
    payerClaimNumber: null,
    payer: {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: '1EG4TE5MK73',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    },
    priorPayers: [],
    patient: {
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1950-02-03',
      sex: 'F',
      addressLine: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701'
    },
    details: completeCheck().details,
    emergency: true,
    loadedMiles: 7.4,
    lines: [{ code: 'A0427', units: 1, unitCents: 85_000, totalCents: 85_000 }]
  },
  coverageId: 'cov-Medicare',
  pcrNumber: 'PCR-1',
  resubmission: false,
  totalCents: 85_000,
  issues: [],
  warnings: []
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
          waitMs: null,
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

  it('reviews a claim the clearinghouse or payer rejected again, flagging the rejection', async () => {
    const { claims, node } = world();
    claims.events.push(event('approved', 'cov-Medicare', '2025-12-01T00:00:00Z'));
    claims.events.push(event('submitted', 'cov-Medicare', '2025-12-02T00:00:00Z'));
    claims.events.push(event('rejected', 'cov-Medicare', '2025-12-03T00:00:00Z'));
    const review = await run(node('claim-step'), { claimId: 'c1' });
    assert.deepEqual(
      [review.pin, review.outputs.coverageId, review.outputs.issues],
      [
        'review',
        'cov-Medicare',
        [
          {
            level: 'warning',
            field: 'submission',
            message: 'The payer or clearinghouse rejected the last submission',
            coverageId: 'cov-Medicare'
          }
        ]
      ]
    );
    assert.deepEqual(claims.statuses, ['needs_review']);
  });

  it("follows up once the payer's wait is over, and waits out the rest of it before", async () => {
    const { claims, node } = world();
    claims.events.push(event('submitted', 'cov-Medicare', '2025-12-01T00:00:00Z'));
    const step = node('claim-step');
    const due = await run(step, { claimId: 'c1', payerWaitDays: 0 });
    assert.deepEqual([due.pin, due.outputs.waitMs], ['followUp', null]);
    const waiting = await run(step, { claimId: 'c1', payerWaitDays: 45 });
    assert.deepEqual([waiting.pin, waiting.outputs.waitMs], ['await', 14 * 86_400_000]);
    assert.deepEqual(claims.statuses, ['follow_up', 'submitted']);
  });

  it('reconciles an overpayment and closes a paid claim without a status of its own', async () => {
    const overpaid = world();
    overpaid.claims.events.push({
      ...event('response', 'cov-Medicare', '2025-12-20T00:00:00Z'),
      paidCents: 120_000
    });
    const over = await run(overpaid.node('claim-step'), { claimId: 'c1' });
    assert.deepEqual([over.pin, over.outputs.balanceCents], ['overpaid', -20_000]);
    assert.deepEqual(overpaid.claims.statuses, ['reconcile']);
    const paid = world();
    paid.claims.events.push({
      ...event('response', 'cov-Medicare', '2025-12-20T00:00:00Z'),
      paidCents: 80_000,
      adjustedCents: 20_000
    });
    const closed = await run(paid.node('claim-step'), { claimId: 'c1' });
    assert.deepEqual([closed.pin, closed.outputs.balanceCents], ['closed', 0]);
    assert.deepEqual(paid.claims.statuses, []);
  });

  it('asks for payers of a claim without any before billing the patient', async () => {
    const { claims, node } = world({ coverages: [] });
    const confirm = await run(node('claim-step'), { claimId: 'c1' });
    assert.deepEqual([confirm.pin, confirm.outputs.coverageId], ['confirmPayers', null]);
    assert.deepEqual(claims.statuses, ['needs_review']);
  });

  it('waits between patient statements, sending the default count when none is set', async () => {
    const { claims, node } = world();
    claims.events.push(event('payer_skipped', 'cov-Medicare', '2025-12-01T00:00:00Z'));
    claims.events.push(event('payer_skipped', 'cov-Blue', '2025-12-01T00:00:00Z'));
    claims.events.push(event('statement', null, '2025-12-20T00:00:00Z'));
    const waiting = await run(node('claim-step'), { claimId: 'c1', statementCount: -1 });
    assert.deepEqual(
      [waiting.pin, waiting.outputs.waitMs, waiting.outputs.statementCount],
      ['awaitPatient', 18 * 86_400_000, 3]
    );
    const later = await run(node('claim-step'), { claimId: 'c1', statementIntervalDays: 10 });
    assert.deepEqual([later.pin, later.outputs.statementNumber], ['statement', 2]);
    assert.deepEqual(claims.statuses, ['patient_balance', 'patient_balance']);
  });

  it('records only the events that apply to the payer being billed', async () => {
    const { claims, node } = world();
    claims.events.push(event('submitted', 'cov-Medicare', '2025-12-01T00:00:00Z'));
    claims.events.push(event('response', 'cov-Medicare', '2025-12-20T00:00:00Z'));
    const record = node('record-claim-event');
    await run(record, { claimId: 'c1', kind: 'follow_up' });
    await run(record, { claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.length, 2);
    await run(record, { claimId: 'c1', kind: 'reconciled', coverageId: 'cov-Medicare' });
    await run(record, {
      claimId: 'c1',
      kind: 'statement',
      note: ' Mailed ',
      payerClaimNumber: 'X'
    });
    assert.deepEqual(
      claims.events.slice(2).map((e) => [e.kind, e.coverageId, e.note, e.payerClaimNumber]),
      [
        ['reconciled', 'cov-Medicare', '', null],
        ['statement', null, 'Mailed', null]
      ]
    );
  });

  it('links its run to the claim it follows', async () => {
    const { claims, node } = world();
    await run(node('follow-claim'), { claimId: 'c1' });
    assert.deepEqual(claims.attached, ['claim:c1']);
    await assert.rejects(async () => run(node('follow-claim'), { claimId: ' ' }), /No claim/);
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

  it('files an approved claim as its own 837P without anyone asking for it', async () => {
    const { claims, node } = world({ submission: { submitter: sampleSubmitter, pending } });
    const prepared = await run(node('prepare-837p'), { claimId: 'c1' });
    assert.deepEqual([prepared.pin, prepared.outputs.claim], ['ready', pending.claim]);
    const filed = await run(node('file-837p'), {
      claimId: 'c1',
      coverageId: 'cov-Medicare',
      x837: sampleX837
    });
    assert.deepEqual([filed.pin, filed.outputs.controlNumber], ['filed', 1]);
    const [file] = claims.filed;
    assert.deepEqual([file?.coverageId, file?.resubmission], ['cov-Medicare', false]);
    assert.ok(file?.file.startsWith('ISA*'));
    assert.ok(file?.file.includes('CLM*c-1*'));
  });

  it('says why an approved claim cannot be filed instead of faulting', async () => {
    const unprofiled = world({ submission: { submitter: null, pending } });
    const filing = { claimId: 'c1', coverageId: 'cov-Medicare', x837: sampleX837 };
    const blocked = await run(unprofiled.node('file-837p'), filing);
    assert.deepEqual(
      [blocked.pin, blocked.outputs.reason],
      ['blocked', 'Add a billing profile in Settings']
    );
    assert.equal(unprofiled.claims.filed.length, 0);
    const issues = world({
      submission: { submitter: sampleSubmitter, pending: { ...pending, issues: ['No NPI'] } }
    });
    const flagged = await run(issues.node('file-837p'), filing);
    assert.deepEqual([flagged.pin, flagged.outputs.reason], ['blocked', 'No NPI']);
    const ready = world({ submission: { submitter: sampleSubmitter, pending } });
    const unmapped = await run(ready.node('file-837p'), {
      ...filing,
      x837: { ...sampleX837, lines: [] }
    });
    assert.equal(unmapped.pin, 'blocked');
    assert.match(
      String(unmapped.outputs.reason),
      /^The 837P mapping is incomplete: .*service line/
    );
    assert.equal(ready.claims.filed.length, 0);
    const used = world({
      submission: { submitter: sampleSubmitter, pending },
      saving: 'exhausted'
    });
    const exhausted = await run(used.node('file-837p'), filing);
    assert.deepEqual(
      [exhausted.pin, exhausted.outputs.reason],
      ['blocked', 'Batch control numbers are used up; contact support']
    );
  });

  it('decides again when the claim is no longer waiting to be filed for that payer', async () => {
    const gone = world({ submission: { submitter: sampleSubmitter, pending: null } });
    assert.equal((await run(gone.node('prepare-837p'), { claimId: 'c1' })).pin, 'stale');
    const moved = world({ submission: { submitter: sampleSubmitter, pending } });
    const other = await run(moved.node('file-837p'), {
      claimId: 'c1',
      coverageId: 'cov-Blue',
      x837: sampleX837
    });
    assert.equal(other.pin, 'stale');
    const changed = world({ submission: { submitter: sampleSubmitter, pending }, saving: 'stale' });
    const raced = await run(changed.node('file-837p'), {
      claimId: 'c1',
      coverageId: 'cov-Medicare',
      x837: sampleX837
    });
    assert.equal(raced.pin, 'stale');
  });

  it('sends a filed 837P to the clearinghouse, or leaves it to the biller without a connection', async () => {
    const connected = world({ sending: { sentAs: '837P-000000001-abcd1234.txt' } });
    const sent = await run(connected.node('send-837p'), { claimId: 'c1', controlNumber: 1 });
    assert.deepEqual([sent.pin, sent.outputs.sentAs], ['sent', '837P-000000001-abcd1234.txt']);
    assert.deepEqual(connected.claims.sent, [1]);
    const offline = world();
    const manual = await run(offline.node('send-837p'), { claimId: 'c1', controlNumber: 1 });
    assert.deepEqual([manual.pin, manual.outputs.sentAs], ['manual', null]);
    assert.deepEqual(offline.claims.sent, []);
  });
});
