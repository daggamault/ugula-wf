import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { sql } from 'kysely';
import {
  buildFindPublishedGraphs,
  buildLatestVersion,
  buildPinRunGraphs,
  dependencyOf,
  findDefinitions,
  findOrganizationGraphs,
  findPublishedGraphs,
  findRuleBundle,
  findRunGraphs,
  pinRunGraphs,
  pinRunsGraphs,
  resolvedGraph
} from './graph-versions.ts';
import { createDummyDb, createRecordingDb } from './testing.ts';

describe('shared graph queries', () => {
  it('resolves each requested version from the agency, then its organization, then the system', async () => {
    const db = createDummyDb();
    const compiled = buildFindPublishedGraphs('t-1', [{ key: 'a.b', version: 2 }]).compile(db);
    const sql = compiled.sql.replace(/\s+/g, ' ');
    assert.ok(sql.includes('cross join lateral'));
    assert.ok(
      sql.includes('order by g.agency_id is null, g.organization_id is null, v.version desc')
    );
    assert.ok(
      sql.includes(
        '"g"."agency_id" is null and "g"."organization_id" = (select a.organization_id from agencies a where a.id = $'
      )
    );
    assert.ok(
      sql.includes('or (bg.is_active and bg.agency_id is null and bg.organization_id = (select')
    );
    assert.ok(sql.includes('order by bg.organization_id is not null limit 1'));
    assert.ok(
      sql.includes(
        'case when base.id is null or base.id = g.id then v.version = "req"."version" else v.contract = base.contract end'
      )
    );
    assert.ok(!sql.includes('workflow_run_graphs'));
    assert.deepEqual(compiled.parameters.slice(0, 2), [['a.b'], [2]]);
    assert.equal(compiled.parameters.filter((p) => p === 't-1').length, 3);
    assert.deepEqual(await findPublishedGraphs(db, 't-1', []), []);
    assert.deepEqual(await findDefinitions(db, []), []);
    await db.destroy();
  });

  it('prefers the version a parent run pinned before resolving afresh', async () => {
    const db = createDummyDb();
    const compiled = buildFindPublishedGraphs('t-1', [{ key: 'a.b', version: 2 }], 'p-1').compile(
      db
    );
    const sql = compiled.sql.replace(/\s+/g, ' ');
    assert.ok(
      sql.includes(
        'select coalesce( ( select p.graph_version_id from workflow_run_graphs p where p.run_id = $'
      )
    );
    assert.ok(sql.includes('and p.key = "req"."key" and p.version = "req"."version"'));
    assert.ok(compiled.parameters.includes('p-1'));
    const { db: recording, queries } = createRecordingDb(() => [{ id: 'v-1' }]);
    assert.deepEqual(
      await findPublishedGraphs(recording, 't-1', [{ key: 'a.b', version: 2 }], 'p-1'),
      [{ id: 'v-1' }]
    );
    assert.ok(queries[0]?.parameters.includes('p-1'));
    await db.destroy();
    await recording.destroy();
  });

  it('pins the graphs a run uses by walking dependencies for its agency', async () => {
    const db = createDummyDb();
    const compiled = buildPinRunGraphs('r-1', 't-1', 'v-1').compile(db);
    assert.ok(compiled.sql.includes('insert into workflow_run_graphs'));
    assert.ok(compiled.sql.includes('with recursive bundle'));
    assert.ok(compiled.sql.includes('where r.id is not null'));
    assert.ok(!compiled.sql.includes('workflow_run_graphs p'));
    assert.ok(compiled.parameters.includes('r-1') && compiled.parameters.includes('v-1'));
    assert.equal(dependencyOf({ key: 'a.b', version: 3 }), 'a.b@3');
    await db.destroy();
  });

  it('pins a child run to the dependency versions of its parent', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunGraphs(db, { id: 'r-1', agencyId: 't-1', versionId: 'v-1', parentRunId: 'p-1' });
    const [pin] = queries;
    assert.ok(pin?.sql.includes('from workflow_run_graphs p'));
    assert.ok(pin?.sql.includes('p.key = "dep"."key" and p.version = "dep"."version"'));
    assert.ok(pin?.parameters.includes('p-1') && pin.parameters.includes('r-1'));
    assert.ok(queries[1]?.sql.includes('from workflow_run_tables p'));
    await pinRunGraphs(db, { id: 'r-2', agencyId: 't-1', versionId: 'v-1' });
    assert.ok(!queries[2]?.sql.includes('workflow_run_graphs p'));
    assert.ok(!queries[3]?.sql.includes('workflow_run_tables p'));
    await db.destroy();
  });

  it('finds the latest published workflow version of the graph at the bottom: system, organization, agency', async () => {
    const db = createDummyDb();
    const compiled = buildLatestVersion('t-1', 'billing.claim').compile(db);
    const sql = compiled.sql.replace(/\s+/g, ' ');
    assert.ok(sql.includes("g.kind = 'workflow'"));
    assert.ok(sql.includes('"g"."organization_id" is null or "g"."agency_id" = $'));
    assert.ok(
      sql.endsWith(
        'order by g.agency_id is not null, g.organization_id is not null, v.version desc limit 1'
      )
    );
    assert.deepEqual(compiled.parameters, ['billing.claim', 't-1', 't-1']);
    await db.destroy();
  });

  it('resolves for an organization alone, never seeing agency copies', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'v-org' }]);
    assert.deepEqual(await findOrganizationGraphs(db, 'o-1', []), []);
    assert.equal(queries.length, 0);
    await findOrganizationGraphs(db, 'o-1', [{ key: 'a.b', version: 1 }]);
    const sql = queries[0]?.sql.replace(/\s+/g, ' ') ?? '';
    assert.ok(sql.includes('"g"."agency_id" = null::uuid'));
    assert.ok(!sql.includes('from agencies'));
    assert.equal(queries[0]?.parameters.filter((p) => p === 'o-1').length, 2);
    await db.destroy();
  });

  it('resolves the graph in effect for a key from the newest version at the bottom', async () => {
    const db = createDummyDb();
    const compiled = sql`select ${resolvedGraph('t-1', sql`'k'`)}`.compile(db);
    const text = compiled.sql.replace(/\s+/g, ' ');
    assert.ok(text.includes('bv.version = ( select v.version from graphs g'));
    assert.ok(text.includes('order by g.agency_id is not null, g.organization_id is not null'));
    assert.equal(compiled.parameters.filter((p) => p === 't-1').length, 7);
    await db.destroy();
  });

  it('pins the first run, then copies its graphs to the rest of the batch', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunsGraphs(db, { ids: [], agencyId: 't-1', versionId: 'v-1' });
    assert.equal(queries.length, 0);
    await pinRunsGraphs(db, { ids: ['r-1'], agencyId: 't-1', versionId: 'v-1' });
    assert.equal(queries.length, 2);
    await pinRunsGraphs(db, {
      ids: ['r-1', 'r-2', 'r-3'],
      agencyId: 't-1',
      versionId: 'v-1',
      parentRunId: 'p-1'
    });
    const [pin, , copy, copyTables] = queries.slice(2);
    assert.match(pin?.sql ?? '', /with recursive bundle/);
    assert.ok(pin?.parameters.includes('r-1') && pin.parameters.includes('p-1'));
    assert.match(copy?.sql ?? '', /from workflow_run_graphs g/);
    assert.deepEqual(copy?.parameters, [['r-2', 'r-3'], 'r-1']);
    assert.match(copyTables?.sql ?? '', /from workflow_run_tables p/);
    assert.deepEqual(copyTables?.parameters, [['r-2', 'r-3'], 'r-1']);
    await db.destroy();
  });

  it('resolves a rule and every graph it calls for an agency, without a run', async () => {
    const rows = [{ id: 'v-1', key: 'billing.claim-checks', version: 2, definition: {} }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.deepEqual(await findRuleBundle(db, 't-1', 'billing.claim-checks'), rows);
    const [query] = queries;
    assert.match(query?.sql ?? '', /with recursive bundle/);
    assert.match(query?.sql ?? '', /max\(v\.version\)/);
    assert.ok(query?.parameters.includes('billing.claim-checks'));
    assert.ok(query?.parameters.includes('t-1'));
    assert.ok(!(query?.sql ?? '').includes('workflow_run_graphs'));
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
