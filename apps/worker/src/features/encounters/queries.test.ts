import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createEncounterStore } from './queries.ts';

const ENCOUNTER = '0195f2a4-0000-7000-8000-000000000001';
const REPORT = '0195f2a4-0000-7000-8000-000000000002';

describe('createEncounterStore', () => {
  it('saves an encounter in one statement and marks the report it came from', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('insert into encounters')
        ? [{ id: ENCOUNTER, revision: 2, outcome: 'revised' }]
        : []
    );
    const saved = await createEncounterStore(db).saveEncounter(
      'r1',
      'A',
      { narrative: 'x' },
      REPORT
    );
    assert.deepEqual(saved, { id: ENCOUNTER, revision: 2, outcome: 'revised' });
    const [save, mark] = queries;
    assert.deepEqual(save?.parameters, ['r1', '{"narrative":"x"}', 'A', 'A', '{"narrative":"x"}']);
    assert.match(save?.sql ?? '', /where encounters\.data is distinct from excluded\.data/);
    assert.equal(
      mark?.sql,
      'update "import_reports" set "encounter_id" = $1, "outcome" = $2 where "id" = $3 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $4)'
    );
    assert.deepEqual(mark?.parameters, [ENCOUNTER, 'revised', REPORT, 'r1']);
  });

  it('marks no report without one, and fails when nothing was saved', async () => {
    const saved = createRecordingDb(() => [{ id: ENCOUNTER, revision: 1, outcome: 'created' }]);
    await createEncounterStore(saved.db).saveEncounter('r1', 'A', {}, null);
    assert.equal(saved.queries.length, 1);
    const none = createRecordingDb(() => []);
    await assert.rejects(
      createEncounterStore(none.db).saveEncounter('r1', 'A', {}, null),
      /Encounter A could not be saved/
    );
  });

  it('reads an encounter of the run agency with its latest report', async () => {
    const { db, queries } = createRecordingDb(() => [
      { revision: 3, data: { pcrNumber: 'A' }, report_id: REPORT }
    ]);
    const store = createEncounterStore(db);
    assert.deepEqual(await store.findEncounter('r1', ENCOUNTER), {
      revision: 3,
      reportId: REPORT,
      data: { pcrNumber: 'A' }
    });
    assert.equal(await store.findEncounter('r1', 'nope'), null);
    assert.equal(queries.length, 1);
    assert.match(
      queries[0]?.sql ?? '',
      /order by "ir"\."created_at" desc, "ir"\."id" desc limit \$1/
    );
  });
});
