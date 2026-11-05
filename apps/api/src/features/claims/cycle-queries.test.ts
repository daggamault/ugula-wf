import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { hasActiveRun, setCycleRun } from './cycle-queries.ts';

describe('cycle queries', () => {
  it('finds active runs of a claim and links a new cycle run to it', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claim_runs" as "cr"') ? [{ id: 'r1' }] : []
    );
    assert.equal(await hasActiveRun(db, 'c1'), true);
    await setCycleRun(db, 'c1', 'r2');
    const [active, link, cycle] = queries;
    assert.ok(active?.sql.includes('"r"."status" in ('));
    assert.equal(active?.parameters[0], 'c1');
    assert.deepEqual(link?.parameters, ['r2', 'c1']);
    assert.ok(cycle?.sql.startsWith('update "claims" set "cycle_run_id" = $1'));
    assert.deepEqual(cycle?.parameters, ['r2', 'c1']);
    await db.destroy();
  });
});
