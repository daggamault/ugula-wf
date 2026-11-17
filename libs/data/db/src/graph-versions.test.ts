import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type CompiledQuery, sql } from 'kysely';
import { buildCopyRunTables, buildPinRunTables } from './data-tables.ts';
import {
  buildFindPublishedGraphs,
  buildLatestVersion,
  buildPinRunGraphs,
  dependencyOf,
  findDefinitions,
  findPublishedGraphs,
  findRuleBundle,
  findRunGraphs,
  pinRunGraphs,
  pinRunsGraphs,
  resolvedGraph
} from './graph-versions.ts';
import { createDummyDb, createRecordingDb } from './testing.ts';

const flat = (q: CompiledQuery | undefined) => q?.sql.replace(/\s+/g, ' ').trim();

const resolvedSql = (key: string, version: string, agency: string, matched = version) =>
  `( select v.id from graphs g join graph_versions v on v.graph_id = g.id left join lateral ( select bg.id, bv.contract from graphs bg left join graph_versions bv on bv.graph_id = bg.id and bv.version = ${version} and bv.published_at is not null where bg.key = g.key and bg.agency_id is null ) base on true where g.key = ${key} and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = ${agency}::uuid) and case when base.id is null or base.id = g.id then v.version = ${matched} else v.contract = base.contract end order by g.agency_id is null, v.version desc limit 1 )`;

const pinnedSql = (run: string, key: string, version: string, agency: string) =>
  `( select coalesce( ( select p.graph_version_id from workflow_run_graphs p where p.run_id = ${run}::uuid and p.key = ${key} and p.version = ${version} ), ${resolvedSql(key, version, agency)} ) as id )`;

const newestSql = (key: string, kind: string, agency: string) =>
  `select v.version from graphs g join graph_versions v on v.graph_id = g.id where g.key = ${key}${kind} and g.is_active and v.published_at is not null and ("g"."agency_id" is null or "g"."agency_id" = ${agency}::uuid) order by g.agency_id is not null, v.version desc limit 1`;

const dependencies =
  "select r.id, dep.key, dep.version from bundle b join graph_versions gv on gv.id = b.id cross join lateral ( select split_part(d, '@', 1) as key, split_part(d, '@', 2)::int as version from unnest(gv.dependencies) as d ) dep cross join lateral";

const pinSql = (lateral: string, run: string) =>
  `insert into workflow_run_graphs (run_id, key, version, graph_version_id) with recursive bundle (id, key, version) as ( select gv.id, g.key, gv.version from graph_versions gv join graphs g on g.id = gv.graph_id where gv.id = $1::uuid union ${dependencies} ${lateral} r where r.id is not null ) select ${run}::uuid, key, version, id from bundle on conflict do nothing`;

const findSql = (lateral: string) =>
  `select r.id, req.key, req.version, gv.definition from unnest($1::text[], $2::int[]) as req (key, version) cross join lateral ${lateral} r join graph_versions gv on gv.id = r.id order by req.key, req.version`;

describe('dependencyOf', () => {
  it('names a dependency by key and version', () => {
    assert.equal(dependencyOf({ key: 'a.b', version: 3 }), 'a.b@3');
  });
});

describe('findPublishedGraphs', () => {
  it('resolves each requested version from the agency, then the system, by contract', async () => {
    const db = createDummyDb();
    const compiled = buildFindPublishedGraphs('t-1', [
      { key: 'a.b', version: 2 },
      { key: 'c.d', version: 1 }
    ]).compile(db);
    assert.equal(flat(compiled), findSql(resolvedSql('"req"."key"', '"req"."version"', '$3')));
    assert.deepEqual(compiled.parameters, [['a.b', 'c.d'], [2, 1], 't-1']);
    await db.destroy();
  });

  it('prefers the version a parent run pinned before resolving afresh', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'v-1' }]);
    assert.deepEqual(await findPublishedGraphs(db, 't-1', [{ key: 'a.b', version: 2 }], 'p-1'), [
      { id: 'v-1' }
    ]);
    assert.equal(
      flat(queries[0]),
      findSql(pinnedSql('$3', '"req"."key"', '"req"."version"', '$4'))
    );
    assert.deepEqual(queries[0]?.parameters, [['a.b'], [2], 'p-1', 't-1']);
    await db.destroy();
  });

  it('reads nothing when no graph is requested', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'v-1' }]);
    assert.deepEqual(await findPublishedGraphs(db, 't-1', []), []);
    assert.equal(queries.length, 0);
    await db.destroy();
  });
});

describe('pinRunGraphs', () => {
  it('pins the graphs a run uses by walking dependencies for its agency', async () => {
    const db = createDummyDb();
    const compiled = buildPinRunGraphs('r-1', 't-1', 'v-1').compile(db);
    assert.equal(flat(compiled), pinSql(resolvedSql('"dep"."key"', '"dep"."version"', '$2'), '$3'));
    assert.deepEqual(compiled.parameters, ['v-1', 't-1', 'r-1']);
    await db.destroy();
  });

  it('pins the graphs, then the tables, of a top-level run', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunGraphs(db, { id: 'r-1', agencyId: 't-1', versionId: 'v-1' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [buildPinRunGraphs('r-1', 't-1', 'v-1'), buildPinRunTables('r-1', 't-1', null)].map((b) => {
        const q = b.compile(db);
        return [q.sql, q.parameters];
      })
    );
    await db.destroy();
  });

  it('pins a child run to the graph and table versions of its parent', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunGraphs(db, { id: 'r-1', agencyId: 't-1', versionId: 'v-1', parentRunId: 'p-1' });
    assert.equal(
      flat(queries[0]),
      pinSql(pinnedSql('$2', '"dep"."key"', '"dep"."version"', '$3'), '$4')
    );
    assert.deepEqual(queries[0]?.parameters, ['v-1', 'p-1', 't-1', 'r-1']);
    const tables = buildPinRunTables('r-1', 't-1', 'p-1').compile(db);
    assert.deepEqual([queries[1]?.sql, queries[1]?.parameters], [tables.sql, tables.parameters]);
    assert.equal(queries.length, 2);
    await db.destroy();
  });
});

describe('pinRunsGraphs', () => {
  it('pins nothing for no runs, and only the run itself for one', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunsGraphs(db, { ids: [], agencyId: 't-1', versionId: 'v-1' });
    assert.equal(queries.length, 0);
    await pinRunsGraphs(db, { ids: ['r-1'], agencyId: 't-1', versionId: 'v-1' });
    assert.deepEqual(
      queries.map((q) => q.parameters.at(-1)),
      ['r-1', 't-1']
    );
    await db.destroy();
  });

  it('pins the first run, then copies its graphs and tables to the rest of the batch', async () => {
    const { db, queries } = createRecordingDb();
    await pinRunsGraphs(db, {
      ids: ['r-1', 'r-2', 'r-3'],
      agencyId: 't-1',
      versionId: 'v-1',
      parentRunId: 'p-1'
    });
    const [pin, pinTables, copy, copyTables] = queries;
    assert.equal(queries.length, 4);
    assert.deepEqual(pin?.parameters, ['v-1', 'p-1', 't-1', 'r-1']);
    assert.equal(pinTables?.sql, buildPinRunTables('r-1', 't-1', 'p-1').compile(db).sql);
    assert.equal(
      flat(copy),
      'insert into workflow_run_graphs (run_id, key, version, graph_version_id) select t.id, g.key, g.version, g.graph_version_id from workflow_run_graphs g cross join unnest($1::uuid[]) as t (id) where g.run_id = $2::uuid on conflict do nothing'
    );
    assert.deepEqual(copy?.parameters, [['r-2', 'r-3'], 'r-1']);
    const tables = buildCopyRunTables('r-1', ['r-2', 'r-3']).compile(db);
    assert.deepEqual([copyTables?.sql, copyTables?.parameters], [tables.sql, tables.parameters]);
    await db.destroy();
  });
});

describe('latest versions', () => {
  it('finds the latest published workflow version of the graph at the bottom: system, then agency', async () => {
    const db = createDummyDb();
    const compiled = buildLatestVersion('t-1', 'billing.claim').compile(db);
    assert.equal(flat(compiled), newestSql('$1', " and g.kind = 'workflow'", '$2'));
    assert.deepEqual(compiled.parameters, ['billing.claim', 't-1']);
    await db.destroy();
  });

  it('resolves the graph in effect for a key from the newest version at the bottom', async () => {
    const db = createDummyDb();
    const compiled = sql`select ${resolvedGraph('t-1', sql`'k'`)}`.compile(db);
    const newest = (agency: string) => `( ${newestSql("'k'", '', agency)})`;
    assert.equal(flat(compiled), `select ${resolvedSql("'k'", newest('$1'), '$2', newest('$3'))}`);
    assert.deepEqual(compiled.parameters, ['t-1', 't-1', 't-1']);
    await db.destroy();
  });
});

describe('findRuleBundle', () => {
  it('resolves a rule at its newest system version and every graph it calls, without a run', async () => {
    const rows = [{ id: 'v-1', key: 'billing.claim-checks', version: 2, definition: {} }];
    const { db, queries } = createRecordingDb(() => rows);
    assert.deepEqual(await findRuleBundle(db, 't-1', 'billing.claim-checks'), rows);
    assert.equal(
      flat(queries[0]),
      `with recursive bundle (id, key, version) as ( select r.id, req.key, req.version from (select $1::text as key, ( select max(v.version) from graphs g join graph_versions v on v.graph_id = g.id where g.key = $2::text and g.agency_id is null and v.published_at is not null ) as version) req cross join lateral ${resolvedSql('"req"."key"', '"req"."version"', '$3')} r where r.id is not null union ${dependencies} ${resolvedSql('"dep"."key"', '"dep"."version"', '$4')} r where r.id is not null ) select b.id, b.key, b.version, gv.definition from bundle b join graph_versions gv on gv.id = b.id order by b.key, b.version`
    );
    assert.deepEqual(queries[0]?.parameters, [
      'billing.claim-checks',
      'billing.claim-checks',
      't-1',
      't-1'
    ]);
    await db.destroy();
  });
});

describe('findRunGraphs and findDefinitions', () => {
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
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "graph_version_id" as "id", "key", "version" from "workflow_run_graphs" where "run_id" = $1 order by "key", "version"',
          ['r-1']
        ],
        ['select "id", "definition" from "graph_versions" where "id" in ($1, $2)', ['v-1', 'v-2']]
      ]
    );
    await db.destroy();
  });

  it('reads no definitions for a run with no pinned graphs', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await findRunGraphs(db, 'r-1'), []);
    assert.deepEqual(await findDefinitions(db, []), []);
    assert.equal(queries.length, 1);
    await db.destroy();
  });
});
