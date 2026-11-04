import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb, createRecordingDb } from '@ugula/db/testing';
import { createAgencyOf, runAgency } from './tenancy.ts';

describe('runAgency', () => {
  it('selects the agency that owns a run', async () => {
    const db = createDummyDb();
    const q = runAgency(db, 'r1').compile();
    assert.equal(q.sql, 'select "agency_id" from "workflow_runs" where "id" = $1');
    assert.deepEqual(q.parameters, ['r1']);
    await db.destroy();
  });
});

describe('createAgencyOf', () => {
  it('uses the agency already known for a run and queries only otherwise', async () => {
    const { db, queries } = createRecordingDb(() => [{ agency_id: 't-db' }]);
    const agencyOf = createAgencyOf(db, (runId) => (runId === 'r1' ? 't-1' : undefined));
    assert.equal(await agencyOf('r1'), 't-1');
    assert.equal(queries.length, 0);
    assert.equal(await agencyOf('r2'), 't-db');
    assert.equal(queries.length, 1);
    await db.destroy();
  });
});
