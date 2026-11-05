import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import type { RuleRunner } from '../../shared/rules.ts';
import { recordAnnouncements } from '../../shared/testing.ts';
import { CLAIM_CHECKS_RULE, createClaimService, NEXT_CLAIM_STEP_RULE } from './service.ts';

const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';

const claim = {
  id: 'c1',
  status: 'submitted',
  patient_id: 'p1',
  total_cents: 100_000,
  balance_cents: 100_000,
  coverages: [{ id: MEDICARE, payer: 'Medicare' }]
};

const setup = ({
  row = claim as Record<string, unknown> | null,
  events = [] as Record<string, unknown>[],
  published = true,
  activeRun = false,
  document = null as Record<string, unknown> | null
} = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.endsWith('for update')) return row ? [row] : [];
    if (q.sql.startsWith('select "id" from "claims"')) return row ? [{ id: 'c1' }] : [];
    if (q.sql.includes('from "claim_events" as "e" inner join "claims"')) {
      return document ? [document] : [];
    }
    if (q.sql.includes('from "claims" as "c"')) return row ? [row] : [];
    if (q.sql.includes('from "claim_runs" as "cr"')) return activeRun ? [{ id: 'r0' }] : [];
    if (q.sql.includes('cross join lateral'))
      return published ? [{ id: 'v-cycle', key: 'billing.cycle-claim', version: 1 }] : [];
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'cycle-2' }];
    if (q.sql.includes('from "claim_events" as "e"')) return events;
    if (q.sql.startsWith('select "document", "file_name" from "claim_documents"')) {
      return document ? [{ ...document, file_name: 'pcs.pdf' }] : [];
    }
    return [];
  });
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_n, batch) => void jobs.push(...batch) };
  const now = () => new Date('2026-01-01T12:00:00.000Z');
  const blobs = { getBytes: async () => new TextEncoder().encode('%PDF-1.7') };
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
    service: createClaimService({ db, boss, now, blobs, announce, rules }),
    jobs,
    queries,
    announced,
    ruled
  };
};

const failure = (res: { ok: boolean; failure?: { code: string; message: string } }) =>
  res.ok ? 'ok' : `${res.failure?.code}: ${res.failure?.message}`;

describe('claim service', () => {
  it('starts a claim task workflow for the claim, assigned to the biller who started it', async () => {
    const { service, queries, jobs, announced } = setup();
    assert.deepEqual(await service.startTask('t', 'u1', 'c1', 'billing.post-payment'), {
      ok: true,
      value: { runId: 'cycle-2' }
    });
    assert.ok(queries.some((q) => JSON.stringify(q.parameters).includes('billing.post-payment')));
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.ok(run?.parameters.includes(JSON.stringify({ claimId: 'c1', assignee: 'u1' })));
    assert.ok(run?.parameters.includes('u1'));
    assert.equal(jobs.length, 1);
    assert.deepEqual(announced, [{ agencyId: 't', event: { kind: 'claim', id: 'c1' } }]);
  });

  it('starts claim tasks on open claims, and on drafts only those that work on drafts', async () => {
    const start = (status: string, key: 'billing.add-document' | 'billing.change-payers') =>
      setup({ row: { ...claim, status } }).service.startTask('t', 'u1', 'c1', key);
    assert.equal(failure(await start('draft', 'billing.add-document')), 'ok');
    assert.match(
      failure(await start('draft', 'billing.change-payers')),
      /^conflict: This claim is still a draft/
    );
    assert.match(
      failure(await start('paid', 'billing.add-document')),
      /^conflict: Claim is already closed/
    );
    assert.match(
      failure(
        await setup({ published: false }).service.startTask('t', 'u1', 'c1', 'billing.set-facility')
      ),
      /^not_found: The billing.set-facility workflow is not published/
    );
    assert.match(
      failure(
        await setup({ row: null }).service.startTask('t', 'u1', 'c1', 'billing.set-facility')
      ),
      /^not_found/
    );
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

  it('serves a claim document by its name', async () => {
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
    const { service, queries, announced } = setup();
    await service.startTask('t', 'u1', 'c1', 'billing.correct-claim-data');
    await service.restartCycle('t', 'c1');
    const locks = queries.filter((q) => q.sql.endsWith('for update'));
    assert.equal(locks.length, 2);
    assert.ok(locks.every((q) => q.sql.includes('"agency_id" = $') && q.parameters.includes('t')));
    assert.deepEqual(
      announced.map((a) => a.agencyId),
      ['t', 't']
    );
    const foreign = setup({ row: null });
    await foreign.service.startTask('other', 'u1', 'c1', 'billing.correct-claim-data');
    await foreign.service.restartCycle('other', 'c1');
    assert.deepEqual(foreign.announced, []);
    assert.ok(!foreign.queries.some((q) => /^(insert|update|delete)/.test(q.sql.trim())));
  });
});
