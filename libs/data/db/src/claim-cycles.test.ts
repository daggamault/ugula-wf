import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { hasActiveRun, restartCycle, setCycleRun } from './claim-cycles.ts';
import { createRecordingDb } from './testing.ts';

const recordingBoss = () => {
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_name, batch) => void jobs.push(...batch) };
  return { boss, jobs };
};

const cycleDb = ({ status = 'submitted' as string | null, active = false, published = true }) =>
  createRecordingDb((q: CompiledQuery) => {
    if (q.sql.endsWith('for update')) return status ? [{ id: 'c1', status, patient_id: 'p1' }] : [];
    if (q.sql.includes('from "claim_runs" as "cr"')) return active ? [{ id: 'r0' }] : [];
    if (q.sql.includes('cross join lateral')) {
      return published ? [{ id: 'v-cycle', key: 'billing.cycle-claim', version: 1 }] : [];
    }
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: 'cycle-2' }];
    return [];
  });

describe('claim cycles', () => {
  it('finds a running, suspended or faulted run of a claim', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'r1' }]);
    assert.equal(await hasActiveRun(db, 'c1'), true);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "r"."id" from "claim_runs" as "cr" inner join "workflow_runs" as "r" ' +
            'on "r"."id" = "cr"."run_id" where "cr"."claim_id" = $1 and "r"."status" in ($2, $3, $4) limit $5',
          ['c1', 'running', 'suspended', 'faulted', 1]
        ]
      ]
    );
  });

  it('leaves out the run asking, and reports a claim without other active runs', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await hasActiveRun(db, 'c1', 'r9'), false);
    assert.match(queries[0]?.sql ?? '', /and "r"\."id" <> \$5 limit \$6$/);
    assert.deepEqual(queries[0]?.parameters.slice(-2), ['r9', 1]);
  });

  it('links a new cycle run to the claim and marks it as the claim cycle', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await setCycleRun(db, 't-1', 'c1', 'r2');
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "claim_runs" ("agency_id", "run_id", "claim_id") values ($1, $2, $3)',
          ['t-1', 'r2', 'c1']
        ],
        [
          'update "claims" set "cycle_run_id" = $1, "updated_at" = now() where "id" = $2',
          ['r2', 'c1']
        ]
      ]
    );
  });

  it('restarts the payer cycle of an open claim of the agency and links it', async () => {
    const { db, queries } = cycleDb({});
    const { boss, jobs } = recordingBoss();
    assert.deepEqual(
      await restartCycle(db, boss, { agencyId: 't', claimId: 'c1', exceptRunId: 'r9' }),
      { ok: true, value: { runId: 'cycle-2' } }
    );
    const lock = queries.find((q) => q.sql.endsWith('for update'));
    assert.deepEqual(lock?.parameters, ['c1', 't']);
    const insert = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.deepEqual(insert?.parameters.slice(0, 3), ['t', 'v-cycle', 'running']);
    assert.equal(insert?.parameters[3], JSON.stringify({ claimId: 'c1' }));
    assert.ok(queries.some((q) => q.sql.startsWith('update "claims" set "cycle_run_id"')));
    assert.deepEqual(jobs, [{ data: { runId: 'cycle-2', command: { type: 'advance' } } }]);
    const interactive = recordingBoss();
    await restartCycle(cycleDb({}).db, interactive.boss, {
      agencyId: 't',
      claimId: 'c1',
      interactive: true
    });
    assert.deepEqual(interactive.jobs, [
      { data: { runId: 'cycle-2', command: { type: 'advance' } }, priority: 2 }
    ]);
  });

  it('refuses a missing, closed or busy claim and an unpublished cycle, starting nothing', async () => {
    const restart = async (opts: Parameters<typeof cycleDb>[0]) => {
      const { db, queries } = cycleDb(opts);
      const result = await restartCycle(db, recordingBoss().boss, {
        agencyId: 't',
        claimId: 'c1'
      });
      assert.ok(!queries.some((q) => q.sql.startsWith('insert into "workflow_runs"')));
      return result.ok ? 'ok' : `${result.failure.code}: ${result.failure.message}`;
    };
    assert.equal(await restart({ status: null }), 'not_found: Claim not found');
    assert.equal(await restart({ status: 'paid' }), 'conflict: Claim is already closed');
    assert.match(await restart({ status: 'draft' }), /^conflict: This claim is still a draft/);
    assert.equal(
      await restart({ active: true }),
      'conflict: This claim still has an active workflow run'
    );
    assert.equal(
      await restart({ published: false }),
      'not_found: The claim cycle workflow is not published'
    );
  });
});
