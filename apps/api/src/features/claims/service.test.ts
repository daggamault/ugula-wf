import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import type { RuleRunner } from '../../shared/rules.ts';
import { recordAnnouncements } from '../../shared/testing.ts';
import {
  CLAIM_CHECKS_RULE,
  createClaimService,
  NEXT_CLAIM_STEP_RULE,
  planPayerOrder
} from './service.ts';

const REQUEST = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';
const BLUE = '01a16617-7704-7ba6-b9b5-000000000002';

const claim = {
  id: 'c1',
  status: 'submitted',
  patient_id: 'p1',
  total_cents: 100_000,
  balance_cents: 100_000,
  coverages: [{ id: MEDICARE, payer: 'Medicare' }]
};

const coverage = (id: string, payer: string, has_events = false) => ({ id, payer, has_events });

const setup = ({
  row = claim as Record<string, unknown> | null,
  coverages = [coverage(MEDICARE, 'Medicare')],
  duplicate = false,
  events = [] as Record<string, unknown>[],
  moot = [] as Record<string, unknown>[],
  published = true,
  activeRun = false,
  document = null as Record<string, unknown> | null,
  paid = 0,
  facility = true
} = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.endsWith('for update')) return row ? [row] : [];
    if (q.sql.includes('sum(paid_cents)')) return [{ paid }];
    if (q.sql.startsWith('select "id" from "claims"')) return row ? [{ id: 'c1' }] : [];
    if (q.sql.startsWith('select "cc"."id"')) return coverages;
    if (q.sql.includes('from "claim_balances"')) return row ? [row] : [];
    if (q.sql.includes('from "claim_events" as "e" inner join "claims"')) {
      return document ? [document] : [];
    }
    if (q.sql.includes('from "claims" as "c"')) return row ? [row] : [];
    if (q.sql.includes('from "claim_runs" as "cr"')) return activeRun ? [{ id: 'r0' }] : [];
    if (q.sql.includes('from "workflow_runs"')) return [{ id: 'r1', wait_id: '7' }];
    if (q.sql.includes('cross join lateral'))
      return published ? [{ id: 'v-cycle', key: 'billing.cycle-claim', version: 1 }] : [];
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'cycle-2' }];
    if (q.sql.includes('from "claim_events"') && q.sql.includes('"source_key" = $')) {
      return duplicate ? [{ id: 'e0' }] : [];
    }
    if (q.sql.includes('from "claim_events" as "e"')) return events;
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (q.sql.startsWith('insert into "claim_documents"')) return [{ id: 'd1' }];
    if (q.sql.startsWith('select "document", "file_name" from "claim_documents"')) {
      return document ? [{ ...document, file_name: 'pcs.pdf' }] : [];
    }
    if (q.sql.startsWith('update "tasks"')) return moot;
    if (q.sql.startsWith('select "name" from "facilities"'))
      return facility ? [{ name: 'Oak Manor' }] : [];
    if (q.sql.startsWith('select "id", "name" from "facilities"'))
      return [{ id: 'f1', name: 'Oak Manor' }];
    if (q.sql.startsWith('update "claims" set "facility_id"'))
      return facility ? [{ id: 'c1' }] : [];
    return [];
  });
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_n, batch) => void jobs.push(...batch) };
  const now = () => new Date('2026-01-01T12:00:00.000Z');
  const stored: string[] = [];
  const removed: string[] = [];
  const blobs = {
    remove: async (ref: { key: string }) => void removed.push(ref.key),
    getBytes: async () => new TextEncoder().encode('%PDF-1.7'),
    putBytes: async (key: string, body: Uint8Array, contentType: string) => {
      stored.push(key);
      return { bucket: 'ugula', key, size: body.byteLength, contentType };
    }
  };
  const { announce, events: announced } = recordAnnouncements();
  const ruled: [string, string, unknown][] = [];
  const rules: RuleRunner = async (agencyId, key, inputs) => {
    ruled.push([agencyId, key, inputs]);
    return key === NEXT_CLAIM_STEP_RULE
      ? { step: 'await', waitMs: 2_548_800_000 }
      : {
          issues: [
            {
              code: 'lines-missing',
              severity: 'blocking',
              field: 'lines',
              message: 'The claim has no charge lines',
              coverageId: null
            }
          ]
        };
  };
  return {
    service: createClaimService({ db, boss, now, blobs, announce, rules, maxBytes: 100 }),
    stored,
    removed,
    jobs,
    queries,
    announced,
    ruled
  };
};

const response = (over: Record<string, unknown> = {}) => ({
  requestId: REQUEST,
  kind: 'response' as 'response' | 'refunded',
  coverageId: MEDICARE as string | null,
  paidCents: 60_000,
  adjustedCents: 10_000,
  paidOn: null as string | null,
  checkNumber: null as string | null,
  payerClaimNumber: null as string | null,
  adjustments: [] as { group: 'CO' | 'PR'; reason: string; cents: number }[],
  note: '',
  ...over
});

const entry = (name: string) => ({
  name,
  relationship: '18' as const,
  insuredFirstName: null,
  insuredLastName: null
});

const failure = (res: { ok: boolean; failure?: { code: string; message: string } }) =>
  res.ok ? 'ok' : `${res.failure?.code}: ${res.failure?.message}`;

describe('planPayerOrder', () => {
  it('keeps known payers by name, adds new ones and lists the dropped ones', () => {
    const plan = planPayerOrder(
      [coverage(MEDICARE, 'Medicare'), coverage(BLUE, 'Blue Plan', true)],
      [entry('Aetna'), entry('medicare')]
    );
    assert.deepEqual(plan.keep, [{ id: MEDICARE, position: 2 }]);
    assert.deepEqual(plan.add, [
      {
        payer: 'Aetna',
        position: 1,
        relationship: '18',
        insuredFirstName: null,
        insuredLastName: null
      }
    ]);
    assert.deepEqual(plan.remove, [BLUE]);
    assert.deepEqual(plan.removed, [coverage(BLUE, 'Blue Plan', true)]);
  });
});

describe('claim service', () => {
  it('records responses under a row lock and wakes the claim cycle', async () => {
    const { service, jobs, queries, announced } = setup();
    assert.deepEqual(await service.recordResponse('t', 'u1', 'c1', response()), {
      ok: true,
      value: { balanceCents: 30_000, adjustedCents: 10_000, duplicate: false }
    });
    assert.deepEqual(announced, [{ agencyId: 't', event: { kind: 'claim', id: 'c1' } }]);
    assert.ok(queries.some((q) => q.sql.endsWith('for update')));
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.parameters.includes(REQUEST) && insert.parameters.includes(MEDICARE));
    assert.deepEqual(
      jobs.map((j) => (j as { data: unknown }).data),
      [{ runId: 'r1', command: { type: 'resume', suspensionId: '7', payload: { payload: null } } }]
    );
  });

  it('stores the paid date, check number and reason codes of a payment', async () => {
    const { service, queries } = setup();
    const res = await service.recordResponse(
      't',
      'u1',
      'c1',
      response({
        paidOn: '2026-10-20',
        checkNumber: 'EFT-1',
        adjustments: [
          { group: 'CO', reason: '45', cents: 10_000 },
          { group: 'PR', reason: '2', cents: 5_000 }
        ]
      })
    );
    assert.equal(failure(res), 'ok');
    const event = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(event?.parameters.includes('2026-10-20') && event.parameters.includes('EFT-1'));
    const reasons = queries.find((q) => q.sql.startsWith('insert into "claim_event_adjustments"'));
    assert.deepEqual(reasons?.parameters, ['e1', 1, 'CO', '45', 10_000, 'e1', 2, 'PR', '2', 5_000]);
  });

  it('records refunds as negative payments up to what was paid and the credit balance', async () => {
    const refund = response({ kind: 'refunded', paidCents: 20_000, adjustedCents: 0 });
    const credit = { ...claim, balance_cents: -20_000 };
    const { service, queries, jobs } = setup({ paid: 50_000, row: credit });
    assert.deepEqual(await service.recordResponse('t', 'u1', 'c1', refund), {
      ok: true,
      value: { balanceCents: 0, adjustedCents: 0, duplicate: false }
    });
    assert.equal(
      failure(await setup({ paid: 50_000 }).service.recordResponse('t', 'u1', 'c1', refund)),
      'invalid: $200.00 is more than the $0.00 credit balance that can be refunded'
    );
    const event = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(event?.parameters.includes('refunded') && event.parameters.includes(-20_000));
    assert.ok(!queries.some((q) => q.sql.startsWith('update "tasks"')));
    assert.equal(jobs.length, 1);
    assert.equal(
      failure(await setup({ paid: 10_000 }).service.recordResponse('t', 'u1', 'c1', refund)),
      'invalid: $200.00 is more than the $100.00 paid that can be refunded'
    );
  });

  it('resolves follow-up and collections tasks the payment made moot', async () => {
    const { service, jobs, queries } = setup({
      moot: [{ run_id: 'cycle-1', wait_id: '12', outcome: 'keepWaiting' }]
    });
    await service.recordResponse('t', 'u1', 'c1', response({ paidCents: 90_000 }));
    const update = queries.find((q) => q.sql.startsWith('update "tasks"'));
    assert.ok(update?.sql.includes("context ->> 'coverageId'"));
    assert.ok(
      update?.sql.includes('"run_id" in (select "run_id" from "claim_runs" where "claim_id" = $')
    );
    assert.ok(update?.parameters.includes(MEDICARE));
    assert.ok(update?.sql.includes('and true)'));
    assert.deepEqual((jobs[0] as { data: unknown }).data, {
      runId: 'cycle-1',
      command: {
        type: 'resume',
        suspensionId: '12',
        payload: { outcome: 'keepWaiting', values: {}, userId: 'u1' }
      }
    });
  });

  it('treats a repeated request as the same payment, even once the claim has closed', async () => {
    const { service, jobs } = setup({ duplicate: true, row: { ...claim, status: 'paid' } });
    assert.deepEqual(await service.recordResponse('t', 'u1', 'c1', response()), {
      ok: true,
      value: { balanceCents: 100_000, adjustedCents: 10_000, duplicate: true }
    });
    assert.equal(jobs.length, 0);
  });

  it('posts overpayments as a credit and rejects responses for unknown, closed or foreign coverages', async () => {
    const record = (opts: Parameters<typeof setup>[0], over: Record<string, unknown> = {}) =>
      setup(opts).service.recordResponse('t', 'u', 'c1', response(over));
    assert.deepEqual(await record({}, { paidCents: 105_000, adjustedCents: 10_000 }), {
      ok: true,
      value: { balanceCents: -5_000, adjustedCents: 0, duplicate: false }
    });
    assert.match(failure(await record({ row: null })), /^not_found/);
    assert.match(failure(await record({ row: { ...claim, status: 'paid' } })), /^conflict/);
    assert.match(failure(await record({}, { coverageId: BLUE })), /^invalid: That payer is not/);
    assert.equal(failure(await record({}, { coverageId: null })), 'ok');
  });

  it('starts a records request on an open claim with its due date and note', async () => {
    const open = setup();
    assert.deepEqual(
      await open.service.requestRecords('t', 'c1', { dueOn: '2026-12-01', note: 'PCR and PCS' }),
      { ok: true, value: { runId: 'cycle-2' } }
    );
    const run = open.queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.ok(run?.parameters.some((p) => String(p).includes('"dueOn":"2026-12-01"')));
    const request = (row: Record<string, unknown> | null, published = true) =>
      setup({ row, published }).service.requestRecords('t', 'c1', { dueOn: null, note: '' });
    assert.match(failure(await request(null)), /^not_found/);
    assert.match(failure(await request({ ...claim, status: 'paid' })), /^conflict/);
    assert.match(failure(await request(claim, false)), /^not_found: The records request/);
  });

  it('makes a facility responsible for a claim, or no facility, and wakes its cycle', async () => {
    const assigned = setup();
    assert.deepEqual(await assigned.service.setFacility('t', 'u1', 'c1', null), {
      ok: true,
      value: { facilityId: null }
    });
    const update = assigned.queries.find((q) =>
      q.sql.startsWith('update "claims" set "facility_id"')
    );
    assert.ok(update?.parameters.includes('t'));
    assert.ok(assigned.queries.some((q) => q.sql.startsWith('insert into "signals"')));
    const toPayers = assigned.queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(toPayers?.parameters, ['c1', 'responsibility', 'Billed to the payers', 'u1']);
    const facility = setup();
    assert.equal(failure(await facility.service.setFacility('t', 'u1', 'c1', MEDICARE)), 'ok');
    const billed = facility.queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(billed?.parameters, ['c1', 'responsibility', 'Billed to Oak Manor', 'u1']);
    const unknown = setup({ facility: false });
    assert.match(
      failure(await unknown.service.setFacility('t', 'u1', 'c1', MEDICARE)),
      /^invalid: That facility/
    );
    assert.ok(!unknown.queries.some((q) => q.sql.startsWith('update "claims" set "facility_id"')));
  });

  it('lists facility choices by name within the agency', async () => {
    const { service, queries } = setup();
    assert.deepEqual(await service.facilityOptions('t', 'oak'), {
      ok: true,
      value: { items: [{ id: 'f1', name: 'Oak Manor' }] }
    });
    const [q] = queries;
    assert.ok(q?.sql.includes('lower(name) like $'));
    assert.deepEqual(q?.parameters, ['t', '%oak%', 20]);
  });

  it('restarts a stopped payer cycle and links the claim to the new run', async () => {
    const stopped = setup();
    assert.deepEqual(await stopped.service.restartCycle('t', 'c1'), {
      ok: true,
      value: { runId: 'cycle-2' }
    });
    assert.ok(stopped.queries.some((q) => q.sql.startsWith('update "claims" set "cycle_run_id"')));
    assert.ok(stopped.queries.some((q) => q.sql.startsWith('insert into "claim_runs"')));
    assert.deepEqual(stopped.jobs, [
      { data: { runId: 'cycle-2', command: { type: 'advance' } }, priority: 2 }
    ]);
    const active = stopped.queries.find((q) => q.sql.includes('from "claim_runs" as "cr"'));
    assert.ok(active?.parameters.includes('running') && active.parameters.includes('faulted'));
    const restart = (row: Record<string, unknown> | null, published = true, activeRun = false) =>
      setup({ row, published, activeRun }).service.restartCycle('t', 'c1');
    assert.match(
      failure(await restart(claim, true, true)),
      /^conflict: This claim still has an active workflow run/
    );
    assert.match(
      failure(await restart({ ...claim, status: 'paid' })),
      /^conflict: Claim is already closed/
    );
    assert.match(failure(await restart(claim, false)), /^not_found: The claim cycle/);
    assert.match(failure(await restart(null)), /^not_found/);
  });

  it('stores an uploaded document, logs it and starts Receive Document for it', async () => {
    const pdf = (bytes: number, type = 'application/pdf') => ({
      kind: 'pcs' as const,
      signedOn: '2025-12-01',
      file: { name: ' pcs form.pdf ', type, bytes: new Uint8Array(bytes) }
    });
    const { service, queries, stored, jobs, announced } = setup();
    assert.deepEqual(await service.uploadDocument('t', 'u1', 'c1', pdf(10)), {
      ok: true,
      value: { id: 'd1', runId: 'cycle-2' }
    });
    assert.match(stored[0] ?? '', /^documents\/t\/c1\/[0-9a-f-]{36}\/pcs_form.pdf$/);
    const saved = queries.find((q) => q.sql.startsWith('insert into "claim_documents"'));
    assert.ok(
      saved?.parameters.includes('pcs form.pdf') && saved.parameters.includes('2025-12-01')
    );
    const logged = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(
      logged?.parameters.includes('Physician certification statement uploaded: pcs form.pdf')
    );
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.ok(run?.parameters.includes(JSON.stringify({ claimId: 'c1', documentId: 'd1' })));
    assert.equal(jobs.length, 1);
    assert.deepEqual(announced, [{ agencyId: 't', event: { kind: 'claim', id: 'c1' } }]);
    assert.match(
      failure(await service.uploadDocument('t', 'u1', 'c1', pdf(0))),
      /^invalid: The file is empty/
    );
    assert.match(
      failure(await service.uploadDocument('t', 'u1', 'c1', pdf(101))),
      /larger than 100/
    );
    assert.match(
      failure(await service.uploadDocument('t', 'u1', 'c1', pdf(5, 'text/html'))),
      /PDF, PNG, JPEG or TIFF/
    );
    assert.match(
      failure(await setup({ row: null }).service.uploadDocument('t', 'u1', 'c1', pdf(5))),
      /^not_found/
    );
    assert.match(
      failure(await setup({ published: false }).service.uploadDocument('t', 'u1', 'c1', pdf(5))),
      /billing.receive-document workflow is not published/
    );
  });

  it('refuses documents for closed claims and drops the file it stored', async () => {
    const pdf = {
      kind: 'pcs' as const,
      signedOn: null,
      file: { name: 'pcs.pdf', type: 'application/pdf', bytes: new Uint8Array(5) }
    };
    const closed = setup({ row: { ...claim, status: 'paid' } });
    assert.match(
      failure(await closed.service.uploadDocument('t', 'u1', 'c1', pdf)),
      /^conflict: Claim is already closed/
    );
    assert.equal(closed.stored.length, 1);
    assert.deepEqual(closed.removed, closed.stored);
    assert.ok(!closed.queries.some((q) => q.sql.startsWith('insert into "claim_documents"')));
    assert.match(
      failure(await closed.service.chaseDocument('t', 'c1', { kind: 'abn', note: null })),
      /^conflict: Claim is already closed/
    );
    assert.ok(!closed.queries.some((q) => q.sql.startsWith('insert into "workflow_runs"')));
  });

  it('serves a claim document and starts a chase for a missing one', async () => {
    const ref = {
      bucket: 'ugula',
      key: 'documents/t/c1/x/pcs.pdf',
      contentType: 'application/pdf'
    };
    const found = await setup({ document: { document: ref } }).service.documentFile(
      't',
      'c1',
      'd1'
    );
    assert.equal(found.ok && found.value.name, 'pcs.pdf');
    assert.match(failure(await setup().service.documentFile('t', 'c1', 'd1')), /^not_found/);
    const { service, queries } = setup();
    assert.deepEqual(await service.chaseDocument('t', 'c1', { kind: 'abn', note: null }), {
      ok: true,
      value: { runId: 'cycle-2' }
    });
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.ok(run?.parameters.includes(JSON.stringify({ claimId: 'c1', kind: 'abn', note: null })));
    assert.match(
      failure(
        await setup({ row: null }).service.chaseDocument('t', 'c1', { kind: 'abn', note: null })
      ),
      /^not_found/
    );
  });

  it('applies only the billing data given, logs the edit and wakes the claim cycle', async () => {
    const edit = {
      id: MEDICARE,
      memberId: '1EG',
      groupId: null,
      relationship: null,
      insuredFirstName: null,
      insuredLastName: null,
      remove: false
    };
    const data = {
      patient: null,
      coverages: [edit],
      serviceDate: '2026-10-01',
      pickup: null,
      destination: null,
      diagnoses: ['R079', 'I10'],
      originDestination: 'RH',
      documentation: null,
      note: null
    };
    const { service, queries, jobs } = setup();
    assert.deepEqual(await service.saveBillingData('t', 'u1', 'c1', data), {
      ok: true,
      value: { status: 'saved' }
    });
    const edited = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(edited?.parameters, ['c1', 'edited', 'Claim data edited', 'u1', null]);
    const claimUpdate = queries.find((q) => q.sql.startsWith('update "claims" set'));
    assert.deepEqual(claimUpdate?.parameters.slice(0, 3), ['2026-10-01', 'R', 'H']);
    assert.ok(!claimUpdate?.sql.includes('pickup_city'));
    const coverageUpdate = queries.find((q) => q.sql.trim().startsWith('update claim_coverages'));
    assert.ok(coverageUpdate?.parameters.includes('1EG'));
    const diagnoses = queries.find((q) => q.sql.includes('insert into "claim_diagnoses"'));
    assert.deepEqual(diagnoses?.parameters.slice(-6), ['c1', 1, 'R079', 'c1', 2, 'I10']);
    assert.ok(!queries.some((q) => q.sql.startsWith('update "patients"')));
    assert.equal(jobs.length, 1);
    assert.match(
      failure(
        await setup().service.saveBillingData('t', 'u1', 'c1', {
          ...data,
          coverages: [{ ...edit, id: BLUE }]
        })
      ),
      /^invalid: A coverage is not on this claim/
    );
    assert.equal(
      failure(
        await setup({ coverages: [coverage(MEDICARE, 'Medicare', true)] }).service.saveBillingData(
          't',
          'u1',
          'c1',
          { ...data, coverages: [{ ...edit, remove: true }] }
        )
      ),
      'conflict: Medicare already has billing activity on this claim, so it cannot be removed'
    );
    assert.match(
      failure(
        await setup({ row: { ...claim, status: 'paid' } }).service.saveBillingData(
          't',
          'u1',
          'c1',
          data
        )
      ),
      /^conflict/
    );
  });

  it('serves stored statement PDFs only for claims of the agency', async () => {
    const ref = {
      bucket: 'ugula',
      key: 'statements/t/c1/2-abc.pdf',
      size: 8,
      contentType: 'application/pdf'
    };
    const { service, queries } = setup({ document: { document: ref, kind: 'statement' } });
    const found = await service.document('t', 'c1', 'e1');
    assert.ok(found.ok);
    assert.equal(found.value.name, '2-abc.pdf');
    assert.equal(found.value.contentType, 'application/pdf');
    assert.equal(new TextDecoder().decode(found.value.bytes), '%PDF-1.7');
    const lookup = queries.find((q) => q.sql.includes('from "claim_events" as "e" inner join'));
    assert.deepEqual(lookup?.parameters, ['e1', 'c1', 't']);
    assert.match(failure(await setup().service.document('t', 'c1', 'e1')), /^not_found/);
  });

  it('reorders and adds payers on open claims, linking new ones to the directory', async () => {
    const open = setup({ coverages: [coverage(MEDICARE, 'Medicare'), coverage(BLUE, 'Blue')] });
    assert.deepEqual(
      await open.service.setPayers('t', 'c1', ['Blue', 'Medicare', 'Aetna'].map(entry)),
      {
        ok: true,
        value: { payers: ['Blue', 'Medicare', 'Aetna'] }
      }
    );
    const moves = open.queries.filter((q) => q.sql.trim().startsWith('update claim_coverages'));
    assert.deepEqual(
      moves.map((q) => q.parameters),
      [[BLUE, 1, MEDICARE, 2, 'c1']]
    );
    const added = open.queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.ok(added?.sql.includes('(select "id" from "payers" where "agency_id" = $'));
    assert.ok(added?.parameters.includes('Aetna') && added.parameters.includes('aetna'));
    assert.equal(open.jobs.length, 1);
    const closed = setup({ row: { ...claim, status: 'paid' } });
    assert.match(failure(await closed.service.setPayers('t', 'c1', [])), /^conflict/);
    const draft = setup({ row: { ...claim, status: 'draft' } });
    assert.match(
      failure(await draft.service.setPayers('t', 'c1', [])),
      /^conflict: This claim is still a draft/
    );
    assert.match(
      failure(await setup({ row: null }).service.setPayers('t', 'c1', [])),
      /^not_found/
    );
  });

  it('removes untouched payers but keeps any payer with billing activity', async () => {
    const quiet = setup();
    assert.equal(failure(await quiet.service.setPayers('t', 'c1', [])), 'ok');
    assert.ok(quiet.queries.some((q) => q.sql.startsWith('delete from "claim_coverages"')));
    const active = setup({ coverages: [coverage(MEDICARE, 'Medicare', true)] });
    assert.equal(
      failure(await active.service.setPayers('t', 'c1', [])),
      'conflict: Medicare already has billing activity on this claim, so it cannot be removed'
    );
    assert.ok(!active.queries.some((q) => q.sql.startsWith('delete')));
  });

  it('returns a claim with its history and what the cycle is doing now', async () => {
    const events = [
      {
        kind: 'submitted',
        coverage_id: MEDICARE,
        paid_cents: 0,
        adjusted_cents: 0,
        created_at: new Date('2026-01-01T00:00:00.000Z')
      }
    ];
    const { service, ruled } = setup({ events });
    const found = await service.find('t', 'c1');
    assert.ok(found.ok);
    assert.deepEqual(found.value.files, events);
    assert.deepEqual(found.value.issues, [
      {
        code: 'lines-missing',
        severity: 'blocking',
        field: 'lines',
        message: 'The claim has no charge lines',
        coverageId: null
      }
    ]);
    assert.deepEqual(found.value.progress, {
      step: 'await',
      coverage: { id: MEDICARE, payer: 'Medicare', claimFiling: null },
      waitMs: 2_548_800_000,
      balanceCents: 100_000
    });
    assert.deepEqual(
      ruled.map(([agency, key]) => [agency, key]),
      [
        ['t', NEXT_CLAIM_STEP_RULE],
        ['t', CLAIM_CHECKS_RULE]
      ]
    );
    const [, , inputs] = ruled[0] ?? [];
    const { ledger } = inputs as { ledger: Record<string, unknown> };
    assert.deepEqual([ledger.coverageId, ledger.contacted], [MEDICARE, true]);
    const paid = await setup({ row: { ...claim, status: 'paid' } }).service.find('t', 'c1');
    assert.equal(paid.ok && paid.value.progress, null);
    const draft = await setup({ row: { ...claim, status: 'draft' } }).service.find('t', 'c1');
    assert.equal(draft.ok && draft.value.progress, null);
    assert.match(failure(await setup({ row: null }).service.find('t', 'c1')), /^not_found/);
    const page = { page: 1, pageSize: 25, sort: 'when' as const, dir: 'desc' as const };
    const history = await setup({ events }).service.events('t', 'c1', page);
    assert.ok(history.ok);
    assert.equal(history.value.page, 1);
    assert.match(failure(await setup({ row: null }).service.events('t', 'c1', page)), /^not_found/);
    assert.equal(
      (
        await setup().service.list('t', {
          status: 'open',
          page: 1,
          pageSize: 25,
          sort: 'created' as const,
          dir: 'desc' as const
        })
      ).ok,
      true
    );
  });
});

describe('claim service tenancy', () => {
  it('locks every claim write to the agency and announces only the writes that succeed', async () => {
    const data = {
      patient: null,
      coverages: [],
      serviceDate: null,
      pickup: null,
      destination: null,
      diagnoses: null,
      originDestination: null,
      documentation: null,
      note: null
    };
    const { service, queries, announced } = setup();
    await service.setPayers('t', 'c1', [entry('Medicare')]);
    await service.saveBillingData('t', 'u1', 'c1', data);
    await service.restartCycle('t', 'c1');
    const locks = queries.filter((q) => q.sql.endsWith('for update'));
    assert.equal(locks.length, 3);
    assert.ok(locks.every((q) => q.sql.includes('"agency_id" = $') && q.parameters.includes('t')));
    assert.deepEqual(
      announced.map((a) => a.agencyId),
      ['t', 't', 't']
    );
    const foreign = setup({ row: null });
    await foreign.service.setPayers('other', 'c1', []);
    await foreign.service.saveBillingData('other', 'u1', 'c1', data);
    await foreign.service.restartCycle('other', 'c1');
    await foreign.service.recordResponse('other', 'u1', 'c1', response());
    assert.deepEqual(foreign.announced, []);
    assert.ok(!foreign.queries.some((q) => /^(insert|update|delete)/.test(q.sql.trim())));
  });
});
