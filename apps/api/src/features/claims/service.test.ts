import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import type { CompiledQuery } from 'kysely';
import { createClaimService } from './service.ts';

const REQUEST = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const claim = {
  id: 'c1',
  status: 'open',
  payers: ['Medicare'],
  patient_id: 'p1',
  total_cents: 100_000,
  balance_cents: 100_000
};

const setup = ({
  row = claim as Record<string, unknown> | null,
  duplicate = false,
  events = [] as Record<string, unknown>[],
  moot = [] as Record<string, unknown>[],
  published = true,
  document = null as Record<string, unknown> | null
} = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.endsWith('for update')) return row ? [row] : [];
    if (q.sql.includes('from "claim_events" as "e"')) return document ? [document] : [];
    if (q.sql.includes('from "claims" as "c"')) return row ? [row] : [];
    if (q.sql.includes('from "workflow_runs"')) return [{ id: 'r1', wait_id: '7' }];
    if (q.sql.includes('from "graph_versions"'))
      return published ? [{ id: 'v-cycle', key: 'billing.cycle-claim', version: 1 }] : [];
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'cycle-2' }];
    if (q.sql.includes('from "claim_events"') && q.sql.includes('"source_key" = $')) {
      return duplicate ? [{ id: 'e0' }] : [];
    }
    if (q.sql.includes('from "claim_events"')) return events;
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    if (q.sql.startsWith('update "tasks"')) return moot;
    if (q.sql.startsWith('update "claims"')) return row?.status === 'open' ? [{ id: 'c1' }] : [];
    return [];
  });
  const jobs: unknown[] = [];
  const boss: JobBoss = { insert: async (_n, batch) => void jobs.push(...batch) };
  const now = () => new Date('2026-01-01T12:00:00.000Z');
  const blobs = { getBytes: async () => new TextEncoder().encode('%PDF-1.7') };
  return { service: createClaimService({ db, boss, now, blobs }), jobs, queries };
};

const response = (over: Record<string, unknown> = {}) => ({
  requestId: REQUEST,
  payer: 'Medicare' as string | null,
  paidCents: 60_000,
  adjustedCents: 10_000,
  note: '',
  ...over
});

const failure = (res: { ok: boolean; failure?: { code: string; message: string } }) =>
  res.ok ? 'ok' : `${res.failure?.code}: ${res.failure?.message}`;

describe('claim service', () => {
  it('records responses under a row lock and wakes the claim cycle', async () => {
    const { service, jobs, queries } = setup();
    assert.deepEqual(await service.recordResponse('t', 'u1', 'c1', response()), {
      ok: true,
      value: { balanceCents: 30_000, duplicate: false }
    });
    assert.ok(queries.some((q) => q.sql.endsWith('for update')));
    assert.ok(queries.some((q) => q.parameters.includes(REQUEST)));
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
    assert.ok(update?.sql.includes("context ->> 'payer'"));
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

  it('rejects overpayments and responses for unknown, closed or foreign-payer claims', async () => {
    const record = (opts: Parameters<typeof setup>[0], over: Record<string, unknown> = {}) =>
      setup(opts).service.recordResponse('t', 'u', 'c1', response(over));
    assert.equal(
      failure(await record({}, { paidCents: 95_000, adjustedCents: 10_000 })),
      'invalid: $1050.00 is more than the remaining balance of $1000.00'
    );
    assert.match(failure(await record({ row: null })), /^not_found/);
    assert.match(failure(await record({ row: { ...claim, status: 'paid' } })), /^conflict/);
    assert.match(failure(await record({}, { payer: 'Aetna' })), /^invalid: Aetna is not a payer/);
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

  it('saves billing data for open claims, updating the patient address', async () => {
    const empty = { name: null, addressLine: null, city: null, state: null, postalCode: null };
    const data = {
      patient: { addressLine: '1 Main', city: 'Springfield', state: 'IL', postalCode: '62704' },
      coverages: [{ payer: 'Medicare', memberId: '1EG', groupId: null }],
      serviceDate: '2026-10-01',
      pickup: empty,
      destination: empty,
      diagnoses: ['R079', 'R079'],
      originDestination: 'RH'
    };
    const { service, queries } = setup();
    assert.deepEqual(await service.saveBillingData('t', 'c1', data), {
      ok: true,
      value: { status: 'saved' }
    });
    const claimUpdate = queries.find((q) => q.sql.startsWith('update "claims" set "coverages"'));
    assert.ok(String(claimUpdate?.parameters[1]).includes('"diagnoses":["R079"]'));
    assert.ok(String(claimUpdate?.parameters[1]).includes('"originDestination":"RH"'));
    const patientUpdate = queries.find((q) => q.sql.startsWith('update "patients"'));
    assert.deepEqual(patientUpdate?.parameters.slice(-2), ['p1', 't']);
    assert.match(
      failure(
        await setup().service.saveBillingData('t', 'c1', {
          ...data,
          coverages: [{ payer: 'Aetna', memberId: null, groupId: null }]
        })
      ),
      /^invalid: Aetna is not a payer/
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
    const lookup = queries.find((q) => q.sql.includes('from "claim_events" as "e"'));
    assert.deepEqual(lookup?.parameters, ['e1', 'c1', 't']);
    assert.match(failure(await setup().service.document('t', 'c1', 'e1')), /^not_found/);
  });

  it('reorders payers on open claims and reports closed or missing ones', async () => {
    const open = setup();
    assert.deepEqual(await open.service.setPayers('t', 'c1', ['Blue', 'Medicare']), {
      ok: true,
      value: { payers: ['Blue', 'Medicare'] }
    });
    assert.equal(open.jobs.length, 1);
    const closed = setup({ row: { ...claim, status: 'paid' } });
    assert.match(failure(await closed.service.setPayers('t', 'c1', [])), /^conflict/);
    assert.match(
      failure(await setup({ row: null }).service.setPayers('t', 'c1', [])),
      /^not_found/
    );
  });

  it('returns a claim with its history and what the cycle is doing now', async () => {
    const events = [
      {
        kind: 'submitted',
        payer: 'Medicare',
        paid_cents: 0,
        adjusted_cents: 0,
        created_at: new Date('2026-01-01T00:00:00.000Z')
      }
    ];
    const found = await setup({ events }).service.find('t', 'c1');
    assert.ok(found.ok);
    assert.deepEqual(found.value.progress, {
      step: 'await',
      payer: 'Medicare',
      waitMs: 86_400_000,
      balanceCents: 100_000
    });
    const paid = await setup({ row: { ...claim, status: 'paid' } }).service.find('t', 'c1');
    assert.equal(paid.ok && paid.value.progress, null);
    assert.match(failure(await setup({ row: null }).service.find('t', 'c1')), /^not_found/);
    assert.equal((await setup().service.list('t', { status: 'open', limit: 50 })).ok, true);
  });
});
