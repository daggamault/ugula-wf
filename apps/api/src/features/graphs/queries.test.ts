import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { contractOf } from '@ugula/graph';
import {
  deleteGraph,
  findGraph,
  findVisibleTableKinds,
  insertDraft,
  insertGraph,
  listDependents,
  listEffectiveGraphs,
  listPublishedNodes,
  listVersions,
  publishVersion,
  searchGraphs,
  updateDraft
} from './queries.ts';
import { templateFor } from './service.ts';

const BASE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;
const S = { agencyId: 'a-1' };
const flat = (sql = '') => sql.replace(/\s+/g, ' ').trim();
const visibleTo = (alias: string, n: number) =>
  `( "${alias}"."agency_id" is null or ("${alias}"."is_active" and "${alias}"."agency_id" = $${n}::uuid) )`;
const LATERAL =
  'from "graphs" as "g" left join lateral (select max(gv.version) filter (where gv.published_at is not null) as "published", max(gv.version) filter (where gv.published_at is null) as "draft", (array_agg(gv.trigger order by gv.version desc))[1] as "trigger" from "graph_versions" as "gv" where "gv"."graph_id" = "g"."id") as "v" on true';
/** The search query after its select list: the joins, filters, order and page. */
const tailOf = (sql = '') => flat(sql).slice(flat(sql).indexOf(LATERAL));

const row = {
  id: 'g1',
  key: 'demo.x',
  name: 'X',
  kind: 'node',
  role: 'rule',
  description: '',
  scope: 'agency',
  updated_at: new Date(0),
  published: 2,
  draft: 3,
  overrides: 'g-sys',
  overridden_by: 'g-agency',
  is_stale: true,
  trigger: { kind: 'schedule', every: 'day', hour: 6 },
  total: '1'
};

const isFacet = (sql: string) => sql.includes('group by 1');
const pageOf = <Q extends { sql: string }>(queries: readonly Q[]) =>
  queries.find((q) => !isFacet(q.sql));
const NO_FACETS = { kind: [], scope: [] } as const;
const ALL = { ...BASE, ...NO_FACETS };

describe('searchGraphs', () => {
  it('maps a page of graphs with versions, override links, staleness and facets', async () => {
    const { db } = createRecordingDb((q) =>
      isFacet(q.sql) ? [{ value: 'node', label: null, count: '4' }] : [row]
    );
    assert.deepEqual(await searchGraphs(db, S, ALL), {
      items: [
        {
          id: 'g1',
          key: 'demo.x',
          name: 'X',
          kind: 'node',
          role: 'rule',
          description: '',
          scope: 'agency',
          isSystem: false,
          overrides: 'g-sys',
          overriddenBy: 'g-agency',
          isStale: true,
          publishedVersion: 2,
          draftVersion: 3,
          trigger: { kind: 'schedule', every: 'day', hour: 6 },
          updatedAt: new Date(0)
        }
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      facets: { kind: [{ value: 'node', count: 4 }], scope: [{ value: 'node', count: 4 }] }
    });
    await db.destroy();
  });

  it('marks system graphs', async () => {
    const { db } = createRecordingDb((q) =>
      isFacet(q.sql) ? [] : [{ ...row, scope: 'system', overrides: null }]
    );
    const page = await searchGraphs(db, S, ALL);
    assert.equal(page.items[0]?.isSystem, true);
    await db.destroy();
  });

  it('selects each visible graph with its scope, links and staleness', async () => {
    const { db, queries } = createRecordingDb();
    await searchGraphs(db, S, ALL);
    const sql = flat(pageOf(queries)?.sql);
    assert.ok(
      sql.startsWith(
        `select "g"."id", "g"."key", "g"."name", "g"."kind", "g"."role", "g"."description", case when "g"."agency_id" is not null then 'agency' else 'system' end as "scope", "g"."updated_at", "v"."published", "v"."draft", "v"."trigger", ( select o.id from "graphs" o where o.id = (`
      )
    );
    assert.ok(
      sql.includes(
        'and case when "o"."agency_id" is not null then 0 else 1 end < case when "g"."agency_id" is not null then 0 else 1 end ) as "overridden_by"'
      )
    );
    assert.ok(
      sql.includes(
        `( select o.id from "graphs" o where o.key = "g"."key" and ${visibleTo('o', 4)} and case when "o"."agency_id" is not null then 0 else 1 end > case when "g"."agency_id" is not null then 0 else 1 end order by case when "o"."agency_id" is not null then 0 else 1 end limit 1 ) as "overrides"`
      )
    );
    assert.ok(
      sql.includes(
        '"g"."agency_id" is not null and exists ( select 1 from "graphs" sg join lateral ( select sv.contract from "graph_versions" sv where sv."graph_id" = sg.id and sv.published_at is not null order by sv.version desc limit 1 ) base on true where sg.key = "g"."key" and sg.agency_id is null and not exists ( select 1 from "graph_versions" mv where mv."graph_id" = "g"."id" and mv.published_at is not null and mv.contract = base.contract ) ) as "is_stale", count(*) over () as "total"'
      )
    );
    await db.destroy();
  });

  it('lists every visible graph when no facet is chosen', async () => {
    const { db, queries } = createRecordingDb();
    await searchGraphs(db, S, ALL);
    assert.equal(
      tailOf(pageOf(queries)?.sql),
      `${LATERAL} where ${visibleTo('g', 5)} order by lower(g.name) asc nulls last, "g"."id" asc limit $6 offset $7`
    );
    await db.destroy();
  });

  it('filters by kind and scope and searches trimmed, escaped names and keys, sorted by kind', async () => {
    const { db, queries } = createRecordingDb();
    await searchGraphs(db, S, {
      ...BASE,
      sort: 'kind',
      dir: 'desc',
      kind: ['node'],
      scope: ['agency'],
      q: ' Ma_ch '
    });
    assert.equal(
      tailOf(pageOf(queries)?.sql),
      `${LATERAL} where ${visibleTo('g', 5)} and (lower(g.name) like $6 or lower(g.key) like $7) and "g"."kind" in ($8) and case when "g"."agency_id" is not null then 'agency' else 'system' end in ($9) order by (g.kind, lower(g.name)) desc nulls last, "g"."id" desc limit $10 offset $11`
    );
    assert.deepEqual(pageOf(queries)?.parameters.slice(5), [
      '%ma\\_ch%',
      '%ma\\_ch%',
      'node',
      'agency',
      25,
      0
    ]);
    await db.destroy();
  });

  it('counts each facet under the search and the other facet', async () => {
    const { db, queries } = createRecordingDb();
    await searchGraphs(db, S, { ...ALL, kind: ['node'], scope: ['agency'], q: 'x' });
    const facets = queries.filter((q) => isFacet(q.sql)).map((q) => flat(q.sql));
    assert.deepEqual(facets, [
      `select "g"."kind"::text as "value", null as "label", count(*) as "count" from "graphs" as "g" where ${visibleTo('g', 1)} and (lower(g.name) like $2 or lower(g.key) like $3) and case when "g"."agency_id" is not null then 'agency' else 'system' end in ($4) and "g"."kind" is not null group by 1 order by count(*) desc, 1 limit $5`,
      `select case when "g"."agency_id" is not null then 'agency' else 'system' end::text as "value", null as "label", count(*) as "count" from "graphs" as "g" where ${visibleTo('g', 1)} and (lower(g.name) like $2 or lower(g.key) like $3) and "g"."kind" in ($4) and case when "g"."agency_id" is not null then 'agency' else 'system' end is not null group by 1 order by count(*) desc, 1 limit $5`
    ]);
    await db.destroy();
  });

  it('sorts by update time', async () => {
    const { db, queries } = createRecordingDb();
    await searchGraphs(db, S, { ...ALL, sort: 'updated' });
    assert.ok(
      flat(pageOf(queries)?.sql).endsWith(
        'order by "g"."updated_at" asc nulls last, "g"."id" asc limit $6 offset $7'
      )
    );
    await db.destroy();
  });

  it('counts the matches separately when a later page is empty', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select count') ? [{ total: '30' }] : []
    );
    const page = await searchGraphs(db, S, { ...ALL, page: 3, kind: ['workflow'] });
    assert.equal(page.total, 30);
    const count = queries.find((q) => q.sql.startsWith('select count'));
    assert.equal(
      flat(count?.sql),
      `select count(*) as "total" ${LATERAL} where ${visibleTo('g', 1)} and "g"."kind" in ($2)`
    );
    assert.deepEqual(count?.parameters, ['a-1', 'workflow']);
    await db.destroy();
  });
});

describe('graph reads', () => {
  it('finds a visible graph by id', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findGraph(db, S, 'g1'), undefined);
    const sql = flat(queries[0]?.sql);
    assert.ok(
      sql.startsWith(
        `select "g"."id", "g"."agency_id", "g"."key", "g"."name", "g"."kind", "g"."role", "g"."description", case when "g"."agency_id" is not null then 'agency' else 'system' end as "scope", (`
      )
    );
    assert.ok(sql.includes(') as "overridden_by", ( select o.id'));
    assert.ok(sql.includes(') as "overrides", "g"."agency_id" is not null and exists ('));
    assert.ok(
      sql.endsWith(
        `) as "is_stale" from "graphs" as "g" where "g"."id" = $5 and ${visibleTo('g', 6)}`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['a-1', 'a-1', 'a-1', 'a-1', 'g1', 'a-1']);
    await db.destroy();
  });

  it('reads versions newest first with the version they were copied from', async () => {
    const { db, queries } = createRecordingDb();
    await listVersions(db, 'g1');
    assert.equal(
      queries[0]?.sql,
      'select "v"."id", "v"."version", "v"."published_at", "v"."created_at", "v"."updated_at", "b"."version" as "base_version", "bg"."id" as "base_graph_id" from "graph_versions" as "v" left join "graph_versions" as "b" on "b"."id" = "v"."base_version_id" left join "graphs" as "bg" on "bg"."id" = "b"."graph_id" where "v"."graph_id" = $1 order by "v"."version" desc'
    );
    assert.deepEqual(queries[0]?.parameters, ['g1']);
    await db.destroy();
  });

  it('lists published standard nodes and custom nodes that override nothing visible', async () => {
    const { db, queries } = createRecordingDb();
    await listPublishedNodes(db, S);
    const sql = flat(queries[0]?.sql);
    assert.ok(
      sql.startsWith(
        `select "g"."id" as "graph_id", "g"."key", "g"."name", "g"."kind", "g"."role", "g"."description", "gv"."version", gv.definition -> 'signature' as "signature", ( select o.id from "graphs" o`
      )
    );
    assert.ok(
      sql.endsWith(
        `) is not null as "overridden" from "graph_versions" as "gv" inner join "graphs" as "g" on "g"."id" = "gv"."graph_id" where "gv"."published_at" is not null and ${visibleTo('g', 4)} and ("g"."agency_id" is null or not exists (select "b"."id" from "graphs" as "b" where "b"."key" = "g"."key" and case when "b"."agency_id" is not null then 0 else 1 end > case when "g"."agency_id" is not null then 0 else 1 end and ${visibleTo('b', 5)})) order by "g"."key", "gv"."version" desc`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['a-1', 'a-1', 'a-1', 'a-1', 'a-1']);
    await db.destroy();
  });

  it('lists the other active agency graphs whose newest version depends on a key', async () => {
    const { db, queries } = createRecordingDb(() => [{ name: 'Flow' }]);
    assert.deepEqual(await listDependents(db, S, 'acme.x', 'g1'), [{ name: 'Flow' }]);
    assert.equal(
      flat(queries[0]?.sql),
      `select distinct g.name from graphs g join lateral ( select v.dependencies from graph_versions v where v.graph_id = g.id and v.published_at is not null order by v.version desc limit 1 ) newest on true where g.id <> $1::uuid and g.is_active and g.agency_id = $2::uuid and exists ( select 1 from unnest(newest.dependencies) d where split_part(d, '@', 1) = $3 ) order by g.name`
    );
    assert.deepEqual(queries[0]?.parameters, ['g1', 'a-1', 'acme.x']);
    await db.destroy();
  });

  it('finds the kinds of visible tables by key', async () => {
    const { db, queries } = createRecordingDb(() => [{ key: 'k1', kind: 'decide' }]);
    assert.deepEqual(await findVisibleTableKinds(db, S, ['k1', 'k2']), [
      { key: 'k1', kind: 'decide' }
    ]);
    assert.equal(
      flat(queries[0]?.sql),
      `select distinct "t"."key", "t"."kind" from "data_tables" as "t" where "t"."key" in ($1, $2) and ${visibleTo('t', 3)}`
    );
    assert.deepEqual(queries[0]?.parameters, ['k1', 'k2', 'a-1']);
    await db.destroy();
  });

  it('finds no table kinds without asking when there are no keys', async () => {
    const { db, queries } = createRecordingDb();
    assert.deepEqual(await findVisibleTableKinds(db, S, []), []);
    assert.equal(queries.length, 0);
    await db.destroy();
  });

  it('resolves the effective graph of every visible key', async () => {
    const graph = { id: 'g1', key: 'a.b', name: 'B', kind: 'node', role: 'rule', scope: 'system' };
    const { db, queries } = createRecordingDb(() => [graph]);
    assert.deepEqual(await listEffectiveGraphs(db, S), [graph]);
    const sql = flat(queries[0]?.sql);
    assert.ok(
      sql.startsWith(
        `select g.id, g.key, g.name, g.kind, g.role, case when "g"."agency_id" is not null then 'agency' else 'system' end as scope, v.definition from (select distinct k.key from graphs k where ${visibleTo('k', 1)}) keys cross join lateral (select ( select v.id from graphs g`
      )
    );
    assert.ok(
      sql.endsWith(
        'as id) r join graph_versions v on v.id = r.id join graphs g on g.id = v.graph_id order by g.key'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['a-1', 'a-1', 'a-1', 'a-1']);
    await db.destroy();
  });
});

describe('graph writes', () => {
  it('publishes a draft once with its dependencies', async () => {
    const { db, queries } = createRecordingDb();
    await publishVersion(db, 'v1', ['d1']);
    assert.equal(
      queries[0]?.sql,
      'update "graph_versions" set "published_at" = now(), "dependencies" = $1, "updated_at" = now() where "id" = $2 and "published_at" is null'
    );
    assert.deepEqual(queries[0]?.parameters, [['d1'], 'v1']);
    await db.destroy();
  });

  it('rewrites only the unpublished draft and keeps its contract current', async () => {
    const { db, queries } = createRecordingDb();
    const def = templateFor('node');
    await updateDraft(db, 'v1', def);
    assert.equal(
      queries[0]?.sql,
      'update "graph_versions" set "definition" = $1, "contract" = $2, "updated_at" = now() where "id" = $3 and "published_at" is null'
    );
    assert.deepEqual(queries[0]?.parameters, [
      JSON.stringify(def),
      contractOf(def.signature),
      'v1'
    ]);
    await db.destroy();
  });

  it('moves a draft onto a new base or clears it', async () => {
    const { db, queries } = createRecordingDb();
    const def = templateFor('node');
    await updateDraft(db, 'v1', def, 'base');
    await updateDraft(db, 'v1', def, null);
    const [rebased, cleared] = queries;
    assert.equal(
      rebased?.sql,
      'update "graph_versions" set "definition" = $1, "contract" = $2, "base_version_id" = $3, "updated_at" = now() where "id" = $4 and "published_at" is null'
    );
    assert.deepEqual(rebased?.parameters.slice(2), ['base', 'v1']);
    assert.deepEqual(cleared?.parameters.slice(2), [null, 'v1']);
    await db.destroy();
  });

  it('inserts a graph for its agency', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'g1' }]);
    const created = await insertGraph(db, {
      agencyId: 'a-1',
      key: 'acme.flow',
      name: 'Flow',
      kind: 'workflow',
      role: 'workflow',
      description: ''
    });
    assert.deepEqual(created, { id: 'g1' });
    assert.equal(
      queries[0]?.sql,
      'insert into "graphs" ("agency_id", "key", "name", "kind", "role", "description") values ($1, $2, $3, $4, $5, $6) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      'a-1',
      'acme.flow',
      'Flow',
      'workflow',
      'workflow',
      ''
    ]);
    await db.destroy();
  });

  it('inserts a draft with its contract, base and author', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'v1', version: 1 }]);
    const def = templateFor('workflow');
    const draft = await insertDraft(db, {
      graphId: 'g1',
      version: 1,
      definition: def,
      baseVersionId: 'b1',
      userId: 'u-1'
    });
    assert.deepEqual(draft, { id: 'v1', version: 1 });
    assert.equal(
      queries[0]?.sql,
      'insert into "graph_versions" ("graph_id", "version", "definition", "contract", "base_version_id", "created_by_id") values ($1, $2, $3, $4, $5, $6) returning "id", "version"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      'g1',
      1,
      JSON.stringify(def),
      contractOf(def.signature),
      'b1',
      'u-1'
    ]);
    await db.destroy();
  });

  it('deletes custom graphs only', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await deleteGraph(db, 'g1'), undefined);
    assert.equal(
      queries[0]?.sql,
      'delete from "graphs" where "id" = $1 and "agency_id" is not null returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['g1']);
    await db.destroy();
  });
});
