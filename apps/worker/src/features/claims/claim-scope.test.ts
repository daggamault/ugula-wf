import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { agencyClaim, linkClaimRun } from './claim-scope.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

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
    assert.ok(link?.sql.startsWith('insert into "claim_runs" ("agency_id", "run_id", "claim_id")'));
    assert.ok(
      link?.sql.includes('select "agency_id", "id", $1::uuid as "claim_id" from "workflow_runs"')
    );
    assert.ok(link?.sql.endsWith('on conflict ("run_id") do nothing'));
    assert.deepEqual(link?.parameters, [ID, 'r1', ID]);
  });
});
