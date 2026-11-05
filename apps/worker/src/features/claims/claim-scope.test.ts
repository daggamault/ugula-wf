import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { type RunJob, type RunQueueClient, resume } from '@ugula/run-queue';
import { agencyClaim, linkClaimRun, signalClaim } from './claim-scope.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const CYCLE = '0195f2a4-0000-7000-8000-0000000000c1';

describe('claim scope', () => {
  it('finds a claim only in the run agency and refuses unknown or malformed ids', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: ID, agency_id: 't-1' }]);
    assert.deepEqual(await agencyClaim(db, 'r1', ID), { id: ID, agency_id: 't-1' });
    assert.ok(queries[0]?.sql.includes('"agency_id" = (select "agency_id" from "workflow_runs"'));
    assert.deepEqual(queries[0]?.parameters, [ID, 'r1']);
    await assert.rejects(agencyClaim(db, 'r1', 'bad'), /Claim bad does not exist/);
    assert.equal(queries.length, 1);
    await assert.rejects(agencyClaim(createRecordingDb().db, 'r1', ID), /does not exist/);
  });

  it('links a run of the claim agency to the claim once', async () => {
    const { db, queries } = createRecordingDb();
    await linkClaimRun(db, 'r1', ID);
    const [link] = queries;
    assert.ok(link?.sql.startsWith('insert into "claim_runs" ("run_id", "claim_id")'));
    assert.ok(link?.sql.includes('select "id", $1::uuid as "claim_id" from "workflow_runs"'));
    assert.ok(link?.sql.endsWith('on conflict ("run_id") do nothing'));
    assert.deepEqual(link?.parameters, [ID, 'r1', ID]);
  });

  it('counts a claim signal and resumes the runs waiting on it', async () => {
    const jobs: RunJob[] = [];
    const boss: RunQueueClient = {
      insert: async (_, inserted) => {
        jobs.push(...inserted.map((j) => j.data as RunJob));
      }
    };
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", state') ? [{ id: CYCLE, wait_id: 'w1' }] : []
    );
    await signalClaim(db, boss, 't-1', ID);
    const [signal] = queries;
    assert.ok(signal?.sql.startsWith('insert into "signals"'));
    assert.ok(signal?.sql.includes('"received" = signals.received + 1'));
    assert.deepEqual(signal?.parameters.slice(0, 2), ['t-1', `claim:${ID}`]);
    const waiting = queries[1];
    assert.deepEqual(waiting?.parameters, ['t-1', `claim:${ID}`, 'suspended']);
    assert.deepEqual(jobs, [resume(CYCLE, 'w1', { payload: null })]);
  });
});
