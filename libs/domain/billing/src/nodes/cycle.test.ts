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
    deceased: false,
    lines: [{ code: 'A0427', units: 1, unitCents: 85_000, totalCents: 85_000 }]
  },
  coverageId: 'cov-Medicare',
  pcrNumber: 'PCR-1',
  resubmission: false,
  totalCents: 85_000
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
  it('walks a claim through its payer cycle, reading its ledger at every step, and closes it', async () => {
    const { claims, node } = world();
    const [attach, ledger, record, close, issue] = [
      'attach-cycle',
      'read-claim-ledger',
      'record-claim-event',
      'close-claim',
      'issue-statement'
    ].map(node);
    if (!attach || !ledger || !record || !close || !issue) throw new Error('Missing cycle nodes');

    await run(attach, { claimId: 'c1', cycleRunId: 'run-9' });
    assert.deepEqual(claims.attached, ['run-9']);
    await assert.rejects(
      async () => run(attach, { claimId: 'c1', cycleRunId: ' ' }),
      /No cycle run/
    );

    const read = async () => {
      const { outputs } = await run(ledger, { claimId: 'c1' });
      return outputs.ledger as Record<string, unknown>;
    };
    const first = await run(ledger, { claimId: 'c1' });
    assert.deepEqual([first.outputs.signalsSeen, first.outputs.reference], [3, 'PCR-1 · Jane Doe']);
    assert.deepEqual(await read(), {
      balanceCents: 100_000,
      coverageId: 'cov-Medicare',
      payer: 'Medicare',
      payerKind: 'unknown',
      coverageCount: 2,
      contacted: false,
      sinceContactMs: null,
      approved: false,
      unreconciledCoverageId: null,
      unreconciledPayer: null,
      denialRoute: null,
      appeals: 0,
      billFacility: false,
      patientApproved: false,
      statements: 0,
      sinceStatementMs: null,
      sinceFacilityContactMs: null,
      rejection: null
    });
    await run(record, { claimId: 'c1', kind: 'approved', coverageId: 'cov-Blue' });
    assert.equal(claims.events.length, 0);
    await run(record, { claimId: 'c1', kind: 'approved', coverageId: 'cov-Medicare' });
    assert.equal((await read()).approved, true);
    await run(record, { claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.at(-1)?.kind, 'submitted');
    await run(record, { claimId: 'c1', kind: 'submitted', coverageId: 'cov-Medicare' });
    assert.equal(claims.events.filter((e) => e.kind === 'submitted').length, 1);
    assert.deepEqual([(await read()).contacted, (await read()).sinceContactMs], [true, 0]);
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
    assert.deepEqual([(await read()).coverageId, (await read()).payerKind], [null, 'patient']);
    await run(record, { claimId: 'c1', kind: 'payer_skipped' });
    assert.equal(claims.events.at(-1)?.coverageId, 'cov-Blue');
    await run(record, { claimId: 'c1', kind: 'approved' });
    assert.equal((await read()).patientApproved, true);
    claims.events.push(event('statement', null, '2025-12-01T00:00:00.000Z'));
    assert.deepEqual(
      [(await read()).statements, (await read()).sinceStatementMs],
      [1, 31 * 86_400_000]
    );
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
    await assert.rejects(
      async () => run(close, { claimId: 'c1', status: 'gone' }),
      /Unknown claim status/
    );
    await assert.rejects(async () => run(ledger, { claimId: 'c9' }), /does not exist/);
  });

  it('says why the last submission was rejected', async () => {
    const { claims, node } = world();
    claims.events.push(event('submitted', 'cov-Medicare', '2025-12-02T00:00:00Z'));
    claims.events.push(event('rejected', 'cov-Medicare', '2025-12-03T00:00:00Z'));
    const { outputs } = await run(node('read-claim-ledger'), { claimId: 'c1' });
    assert.equal(
      (outputs.ledger as { rejection: string }).rejection,
      'The payer or clearinghouse rejected the last submission'
    );
  });

  it('records the status of the step, nothing for closing steps, and notices a changed claim', async () => {
    const { claims, node } = world();
    const record = node('record-claim-step');
    const set = await run(record, { claimId: 'c1', status: 'needs_review', signalsSeen: 3 });
    assert.equal(set.pin, 'recorded');
    assert.equal((await run(record, { claimId: 'c1', signalsSeen: 3 })).pin, 'recorded');
    assert.deepEqual(claims.statuses, ['needs_review']);
    await assert.rejects(
      async () => run(record, { claimId: 'c1', status: 'lost', signalsSeen: 3 }),
      /Unknown claim status/
    );
    const raced = world({ stale: true });
    const stale = await run(raced.node('record-claim-step'), {
      claimId: 'c1',
      status: 'ready',
      signalsSeen: 3
    });
    assert.equal(stale.pin, 'stale');
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

  it('files an approved claim as its own 837P without anyone asking for it', async () => {
    const { claims, node } = world({ submission: { submitter: sampleSubmitter, pending } });
    const prepared = await run(node('prepare-837p'), { claimId: 'c1', coverageId: 'cov-Medicare' });
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
    assert.equal(
      (await run(gone.node('prepare-837p'), { claimId: 'c1', coverageId: 'cov-Medicare' })).pin,
      'stale'
    );
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
