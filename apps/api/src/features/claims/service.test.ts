import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import type { CompiledQuery } from 'kysely';
import { recordAnnouncements } from '../../shared/testing.ts';
import { createClaimService, planPayerOrder } from './service.ts';

const REQUEST = '01a16617-7704-7ba6-b9b5-9c79fa44f965';
const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';
const BLUE = '01a16617-7704-7ba6-b9b5-000000000002';

const claim = {
  id: 'c1',
  status: 'open',
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
  document = null as Record<string, unknown> | null
} = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.endsWith('for update')) return row ? [row] : [];
    if (q.sql.startsWith('select "cc"."id"')) return coverages;
    if (q.sql.includes('from "claim_balances"')) return row ? [row] : [];
    if (q.sql.includes('from "claim_events" as "e" inner join "claims"')) {
      return document ? [document] : [];
    }
    if (q.sql.includes('from "claims" as "c"')) return row ? [row] : [];
    if (q.sql.includes('from "workflow_runs"')) return [{ id: 'r1', wait_id: '7' }];
    if (q.sql.includes('from "graph_versions"'))
      return published ? [{ id: 'v-cycle', key: 'billing.cycle-claim', version: 1 }] : [];
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'cycle-2' }];
    if (q.sql.includes('from "claim_events"') && q.sql.includes('"source_key" = $')) {
      return duplicate ? [{ id: 'e0' }] : [];
    }
    if (q.sql.includes('from "claim_events" as "e"')) return events;
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (q.sql.startsWith('update "tasks"')) return moot;
    return [];
  });
  const jobs: unknown[] = [];
  const boss: JobBoss = { insert: async (_n, batch) => void jobs.push(...batch) };
  const now = () => new Date('2026-01-01T12:00:00.000Z');
  const blobs = { getBytes: async () => new TextEncoder().encode('%PDF-1.7') };
  const { announce, events: announced } = recordAnnouncements();
  return {
    service: createClaimService({ db, boss, now, blobs, announce }),
    jobs,
    queries,
    announced
  };
};

const response = (over: Record<string, unknown> = {}) => ({
  requestId: REQUEST,
  coverageId: MEDICARE as string | null,
  paidCents: 60_000,
  adjustedCents: 10_000,
  note: '',
  ...over
});

const failure = (res: { ok: boolean; failure?: { code: string; message: string } }) =>
  res.ok ? 'ok' : `${res.failure?.code}: ${res.failure?.message}`;

describe('planPayerOrder', () => {
  it('keeps known payers by name, adds new ones and lists the dropped ones', () => {
    const plan = planPayerOrder(
      [coverage(MEDICARE, 'Medicare'), coverage(BLUE, 'Blue Plan', true)],
      ['Aetna', 'medicare']
    );
    assert.deepEqual(plan.keep, [{ id: MEDICARE, position: 2 }]);
    assert.deepEqual(plan.add, [{ payer: 'Aetna', position: 1 }]);
    assert.deepEqual(plan.remove, [BLUE]);
    assert.deepEqual(plan.removed, [coverage(BLUE, 'Blue Plan', true)]);
  });
});

describe('claim service', () => {
  it('records responses under a row lock and wakes the claim cycle', async () => {
    const { service, jobs, queries, announced } = setup();
    assert.deepEqual(await service.recordResponse('t', 'u1', 'c1', response()), {
      ok: true,
      value: { balanceCents: 30_000, duplicate: false }
    });
    assert.deepEqual(announced, [{ tenantId: 't', event: { kind: 'claim', id: 'c1' } }]);
    assert.ok(queries.some((q) => q.sql.endsWith('for update')));
    const insert = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.parameters.includes(REQUEST) && insert.parameters.includes(MEDICARE));
    assert.deepEqual(jobs, [
      {
        data: {
          runId: 'r1',
          command: { type: 'resume', suspensionId: '7', payload: { payload: null } }
        }
      }
    ]);
  });

  it('resolves follow-up and collections tasks the payment made moot', async () => {
    const { service, jobs, queries } = setup({
      moot: [{ run_id: 'cycle-1', wait_id: '12', outcome: 'keepWaiting' }]
    });
    await service.recordResponse('t', 'u1', 'c1', response({ paidCents: 90_000 }));
    const update = queries.find((q) => q.sql.startsWith('update "tasks"'));
    assert.ok(update?.sql.includes("context ->> 'coverageId'"));
    assert.ok(update?.parameters.includes(MEDICARE));
    assert.ok(update?.sql.includes('and true)'));
    assert.deepEqual(jobs[0], {
      data: {
        runId: 'cycle-1',
        command: {
          type: 'resume',
          suspensionId: '12',
          payload: { outcome: 'keepWaiting', values: {}, userId: 'u1' }
        }
      }
    });
  });

  it('treats a repeated request as the same payment, even once the claim has closed', async () => {
    const { service, jobs } = setup({ duplicate: true, row: { ...claim, status: 'paid' } });
    assert.deepEqual(await service.recordResponse('t', 'u1', 'c1', response()), {
      ok: true,
      value: { balanceCents: 100_000, duplicate: true }
    });
    assert.equal(jobs.length, 0);
  });

  it('rejects overpayments and responses for unknown, closed or foreign coverages', async () => {
    const record = (opts: Parameters<typeof setup>[0], over: Record<string, unknown> = {}) =>
      setup(opts).service.recordResponse('t', 'u', 'c1', response(over));
    assert.equal(
      failure(await record({}, { paidCents: 95_000, adjustedCents: 10_000 })),
      'invalid: $1050.00 is more than the remaining balance of $1000.00'
    );
    assert.match(failure(await record({ row: null })), /^not_found/);
    assert.match(failure(await record({ row: { ...claim, status: 'paid' } })), /^conflict/);
    assert.match(failure(await record({}, { coverageId: BLUE })), /^invalid: That payer is not/);
    assert.equal(failure(await record({}, { coverageId: null })), 'ok');
  });

  it('restarts a stopped payer cycle and links the claim to the new run', async () => {
    const stopped = setup({ row: { ...claim, cycle_status: 'cancelled' } });
    assert.deepEqual(await stopped.service.restartCycle('t', 'c1'), {
      ok: true,
      value: { runId: 'cycle-2' }
    });
    assert.ok(stopped.queries.some((q) => q.sql.startsWith('update "claims" set "cycle_run_id"')));
    assert.deepEqual(stopped.jobs, [{ data: { runId: 'cycle-2', command: { type: 'advance' } } }]);
    const restart = (row: Record<string, unknown> | null, published = true) =>
      setup({ row, published }).service.restartCycle('t', 'c1');
    assert.match(
      failure(await restart({ ...claim, cycle_status: 'suspended' })),
      /^conflict: The payer cycle/
    );
    assert.match(
      failure(await restart({ ...claim, status: 'paid', cycle_status: null })),
      /^conflict: Claim is already closed/
    );
    assert.match(
      failure(await restart({ ...claim, cycle_status: null }, false)),
      /^not_found: The claim cycle/
    );
    assert.match(failure(await restart(null)), /^not_found/);
  });

  it('saves billing data into columns, coverages and diagnoses, and the patient address', async () => {
    const empty = { name: null, addressLine: null, city: null, state: null, postalCode: null };
    const data = {
      patient: { addressLine: '1 Main', city: 'Springfield', state: 'IL', postalCode: '62704' },
      coverages: [{ id: MEDICARE, memberId: '1EG', groupId: null }],
      serviceDate: '2026-10-01',
      pickup: { ...empty, city: 'Springfield' },
      destination: empty,
      diagnoses: ['R079', 'I10'],
      originDestination: 'RH'
    };
    const { service, queries } = setup();
    assert.deepEqual(await service.saveBillingData('t', 'c1', data), {
      ok: true,
      value: { status: 'saved' }
    });
    const claimUpdate = queries.find((q) => q.sql.startsWith('update "claims" set "service_date"'));
    assert.deepEqual(claimUpdate?.parameters.slice(0, 5), [
      '2026-10-01',
      'R',
      'H',
      null,
      'Springfield'
    ]);
    const coverageUpdate = queries.find((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.deepEqual(coverageUpdate?.parameters, ['1EG', null, MEDICARE, 'c1']);
    assert.ok(queries.some((q) => q.sql.startsWith('delete from "claim_diagnoses"')));
    const diagnoses = queries.find((q) => q.sql.startsWith('insert into "claim_diagnoses"'));
    assert.deepEqual(diagnoses?.parameters, ['c1', 1, 'R079', 'c1', 2, 'I10']);
    const patientUpdate = queries.find((q) => q.sql.startsWith('update "patients"'));
    assert.deepEqual(patientUpdate?.parameters.slice(-2), ['p1', 't']);
    assert.match(
      failure(
        await setup().service.saveBillingData('t', 'c1', {
          ...data,
          coverages: [{ id: BLUE, memberId: null, groupId: null }]
        })
      ),
      /^invalid: A coverage is not on this claim/
    );
    assert.match(
      failure(
        await setup({ row: { ...claim, status: 'paid' } }).service.saveBillingData('t', 'c1', data)
      ),
      /^conflict/
    );
  });

  it('serves stored statement PDFs only for claims of the tenant', async () => {
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
    assert.deepEqual(await open.service.setPayers('t', 'c1', ['Blue', 'Medicare', 'Aetna']), {
      ok: true,
      value: { payers: ['Blue', 'Medicare', 'Aetna'] }
    });
    const moves = open.queries.filter((q) => q.sql.startsWith('update "claim_coverages"'));
    assert.deepEqual(
      moves.map((q) => q.parameters.slice(0, 2)),
      [
        [1, BLUE],
        [2, MEDICARE]
      ]
    );
    const added = open.queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.ok(added?.sql.includes('(select "id" from "payers" where "tenant_id" = $'));
    assert.ok(added?.parameters.includes('Aetna') && added.parameters.includes('aetna'));
    assert.equal(open.jobs.length, 1);
    const closed = setup({ row: { ...claim, status: 'paid' } });
    assert.match(failure(await closed.service.setPayers('t', 'c1', [])), /^conflict/);
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
    const found = await setup({ events }).service.find('t', 'c1');
    assert.ok(found.ok);
    assert.deepEqual(found.value.progress, {
      step: 'await',
      coverage: { id: MEDICARE, payer: 'Medicare' },
      waitMs: 2_548_800_000,
      balanceCents: 100_000
    });
    const paid = await setup({ row: { ...claim, status: 'paid' } }).service.find('t', 'c1');
    assert.equal(paid.ok && paid.value.progress, null);
    assert.match(failure(await setup({ row: null }).service.find('t', 'c1')), /^not_found/);
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
