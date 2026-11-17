import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createDocumentStore } from './queries.ts';

describe('createDocumentStore', () => {
  it("reads the kind each open Chase Document run on the claim was started with or a biller chose, in the run's agency", async () => {
    const { db, queries } = createRecordingDb(() => [
      { kind: 'pcs' },
      { kind: null },
      { kind: 'signature' }
    ]);
    assert.deepEqual(await createDocumentStore(db).chasedDocuments('run-1', 'c1'), [
      'pcs',
      'signature'
    ]);
    assert.equal(
      queries[0]?.sql,
      `select coalesce(r.inputs ->> 'kind', (select t.resolution -> 'values' ->> 'kind' as "kind" from "tasks" as "t" where "t"."run_id" = "r"."id" and "t"."status" = $1 and t.resolution ->> 'outcome' = $2 order by "t"."completed_at" desc limit $3)) as "kind" from "workflow_runs" as "r" inner join "graph_versions" as "v" on "v"."id" = "r"."graph_version_id" inner join "graphs" as "g" on "g"."id" = "v"."graph_id" where "r"."agency_id" = (select "agency_id" from "workflow_runs" where "id" = $4) and "r"."status" in ($5, $6, $7) and "g"."key" = $8 and r.inputs ->> 'claimId' = $9`
    );
    assert.deepEqual(queries[0]?.parameters, [
      'completed',
      'chase',
      1,
      'run-1',
      'running',
      'suspended',
      'faulted',
      'billing.chase-document',
      'c1'
    ]);
    await db.destroy();
  });
});
