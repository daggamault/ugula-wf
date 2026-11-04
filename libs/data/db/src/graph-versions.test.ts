import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildFindPublishedGraphs,
  buildPinRunGraphs,
  dependencyOf,
  findDefinitions,
  findPublishedGraphs,
  findRunGraphs,
  pinRunsGraphs
} from './graph-versions.ts';
import { createDummyDb, createRecordingDb } from './testing.ts';

describe('shared graph queries', () => {
  it('resolves each requested version, letting a agency override a system graph', async () => {
    const db = createDummyDb();
    const compiled = buildFindPublishedGraphs('t-1', [{ key: 'a.b', version: 2 }]).compile(db);
    assert.ok(compiled.sql.includes('cross join lateral'));
    assert.ok(compiled.sql.includes('order by g.agency_id nulls last, v.version desc'));
    assert.ok(compiled.sql.includes('s.agency_id is null'));
    assert.deepEqual(compiled.parameters.slice(0, 2), [['a.b'], [2]]);
    assert.ok(compiled.parameters.includes('t-1'));
    assert.deepEqual(await findPublishedGraphs(db, 't-1', []), []);
    assert.deepEqual(await findDefinitions(db, []), []);
    await db.destroy();
  });

  it('pins the graphs a run uses by walking dependencies for its agency', async () => {
    const db = createDummyDb();
    const compiled = buildPinRunGraphs('r-1', 't-1', 'v-1').compile(db);
    assert.ok(compiled.sql.includes('insert into workflow_run_graphs'));
    assert.ok(compiled.sql.includes('with recursive bundle'));
    assert.ok(compiled.parameters.includes('r-1') && compiled.parameters.includes('v-1'));
    assert.equal(dependencyOf({ key: 'a.b', version: 3 }), 'a.b@3');
    await db.destroy();
  });

  it('pins the first run, then copies its graphs to the rest of the batch', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunsGraphs(db, { ids: [], agencyId: 't-1', versionId: 'v-1' });
    assert.equal(queries.length, 0);
    await pinRunsGraphs(db, { ids: ['r-1'], agencyId: 't-1', versionId: 'v-1' });
    assert.equal(queries.length, 1);
    await pinRunsGraphs(db, { ids: ['r-1', 'r-2', 'r-3'], agencyId: 't-1', versionId: 'v-1' });
    const [pin, copy] = queries.slice(1);
    assert.match(pin?.sql ?? '', /with recursive bundle/);
    assert.ok(pin?.parameters.includes('r-1'));
    assert.match(copy?.sql ?? '', /from workflow_run_graphs g/);
    assert.deepEqual(copy?.parameters, [['r-2', 'r-3'], 'r-1']);
    await db.destroy();
  });

  it('loads each pinned graph with its definition, reading each version once', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('"workflow_run_graphs"')
        ? [
            { id: 'v-1', key: 'a', version: 1 },
            { id: 'v-2', key: 'b', version: 1 },
            { id: 'v-1', key: 'c', version: 1 }
          ]
        : [{ id: 'v-1', definition: { nodes: [] } }]
    );
    assert.deepEqual(await findRunGraphs(db, 'r-1'), [
      { id: 'v-1', key: 'a', version: 1, definition: { nodes: [] } },
      { id: 'v-2', key: 'b', version: 1, definition: null },
      { id: 'v-1', key: 'c', version: 1, definition: { nodes: [] } }
    ]);
    assert.deepEqual(queries[1]?.parameters, ['v-1', 'v-2']);
    await db.destroy();
  });
});
