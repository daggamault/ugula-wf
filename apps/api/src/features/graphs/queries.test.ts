import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { contractOf } from '@ugula/graph';
import {
  deleteGraph,
  findDraft,
  findEffectiveGraph,
  findGraph,
  findNewestPublishedVersion,
  findScopedGraph,
  findSystemGraph,
  findVersion,
  findVersionById,
  findVisibleTableKeys,
  insertDraft,
  insertGraph,
  listEffectiveGraphs,
  listPublishedNodes,
  listVersions,
  nextVersion,
  publishVersion,
  searchGraphs,
  setGraphActive,
  updateDraft
} from './queries.ts';
import { templateFor } from './service.ts';

const BASE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;
const S = { agencyId: 'a-1', organizationId: 'o-1' };
const flat = (sql = '') => sql.replace(/\s+/g, ' ');
const visibleTo = (alias: string, a: number, o: number) =>
  `( "${alias}"."organization_id" is null or ("${alias}"."is_active" and "${alias}"."agency_id" = $${a}::uuid) or ("${alias}"."is_active" and "${alias}"."agency_id" is null and "${alias}"."organization_id" = $${o}::uuid) )`;

describe('customization queries', () => {
  it('shows customized graphs, the effective graph and table per key, and known table keys', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchGraphs(db, S, { ...BASE, show: 'customized' });
    assert.ok(flat(queries[0]?.sql).includes('is not null or ( select o.id from "graphs" o'));
    await listEffectiveGraphs(db, S);
    const graphs = flat(queries[1]?.sql);
    assert.ok(graphs.includes('select distinct on (g.key)'));
    assert.ok(graphs.includes('order by gv.version desc limit 1'));
    assert.deepEqual(await findVisibleTableKeys(db, S, []), []);
    assert.equal(queries.length, 2);
    await findVisibleTableKeys(db, S, ['billing.base-rate']);
    assert.ok(queries[2]?.sql.includes('from "data_tables" as "t"'));
    await db.destroy();
  });
});

describe('graph queries', () => {
  it('pages graphs of every scope with versions, override links and staleness', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        id: 'g1',
        key: 'demo.x',
        name: 'X',
        kind: 'node',
        role: 'rule',
        description: '',
        scope: 'organization',
        updated_at: new Date(0),
        published: 2,
        draft: 3,
        overrides: 'g-sys',
        overridden_by: 'g-agency',
        is_stale: true,
        total: '1'
      }
    ]);
    const page = await searchGraphs(db, S, { ...BASE, show: 'all' });
    assert.equal(page.total, 1);
    assert.deepEqual(page.items, [
      {
        id: 'g1',
        key: 'demo.x',
        name: 'X',
        kind: 'node',
        role: 'rule',
        description: '',
        scope: 'organization',
        isSystem: false,
        overrides: 'g-sys',
        overriddenBy: 'g-agency',
        isStale: true,
        publishedVersion: 2,
        draftVersion: 3,
        updatedAt: new Date(0)
      }
    ]);
    const sql = flat(queries[0]?.sql);
    assert.ok(
      sql.includes(
        'left join lateral (select max(gv.version) filter (where gv.published_at is not null)'
      )
    );
    assert.ok(sql.includes(`where ${visibleTo('g', 5, 6)}`));
    assert.ok(sql.includes(') as "overridden_by"'));
    assert.ok(sql.includes(') as "overrides"'));
    assert.ok(sql.includes('sg.organization_id is null and not exists'));
    assert.ok(sql.includes('mv.contract = base.contract'));
    assert.ok(sql.includes('order by lower(g.name) asc nulls last'));
    assert.deepEqual(queries[0]?.parameters.slice(0, 6), [
      'a-1',
      'o-1',
      'a-1',
      'o-1',
      'a-1',
      'o-1'
    ]);
    await db.destroy();
  });

  it('marks system graphs and scopes graphs by agency, then organization, then system', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'g', scope: 'system', updated_at: new Date(0), is_stale: false, total: '1' }
    ]);
    const page = await searchGraphs(db, S, { ...BASE, show: 'all' });
    assert.equal(page.items[0]?.isSystem, true);
    const sql = flat(queries[0]?.sql);
    assert.ok(
      sql.includes(
        `case when "g"."agency_id" is not null then 'agency' when "g"."organization_id" is not null then 'organization' else 'system' end as "scope"`
      )
    );
    assert.ok(
      sql.includes(
        'case when "o"."agency_id" is not null then 0 when "o"."organization_id" is not null then 1 else 2 end < case when "g"."agency_id"'
      )
    );
    assert.ok(sql.includes('end > case when "g"."agency_id"'));
    await db.destroy();
  });

  it('searches names and keys of the kind shown', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const base = { ...BASE, sort: 'kind', dir: 'desc' } as const;
    await searchGraphs(db, S, { ...base, show: 'blocks', q: 'Match' });
    await searchGraphs(db, S, { ...base, show: 'mine' });
    await searchGraphs(db, S, { ...base, show: 'workflows' });
    const [blocks, mine, workflows] = queries;
    assert.ok(blocks?.sql.includes('"g"."kind" != $'));
    assert.ok(blocks?.sql.includes('lower(g.name) like $'));
    assert.ok(blocks?.sql.includes('lower(g.key) like $'));
    assert.ok(blocks?.parameters.includes('%match%'));
    assert.ok(blocks?.sql.includes('order by (g.kind, lower(g.name)) desc nulls last'));
    assert.ok(mine?.sql.includes('and "g"."organization_id" is not null order by'));
    assert.ok(workflows?.sql.includes('"g"."kind" = $'));
    await db.destroy();
  });

  it('finds a visible graph and the effective graph for a key', async () => {
    const { db, queries } = createRecordingDb();
    await findGraph(db, S, 'g1');
    await findEffectiveGraph(db, S, 'acme.flow');
    const [graph, effective] = queries;
    assert.ok(flat(graph?.sql).includes(`where "g"."id" = $5 and ${visibleTo('g', 6, 7)}`));
    assert.deepEqual(graph?.parameters, ['a-1', 'o-1', 'a-1', 'o-1', 'g1', 'a-1', 'o-1']);
    assert.ok(
      flat(effective?.sql).endsWith(
        'order by case when "g"."agency_id" is not null then 0 when "g"."organization_id" is not null then 1 else 2 end limit $4'
      )
    );
    assert.deepEqual(effective?.parameters, ['acme.flow', 'a-1', 'o-1', 1]);
    await db.destroy();
  });

  it('lists built-in nodes and custom nodes that override nothing visible', async () => {
    const { db, queries } = createRecordingDb();
    await listPublishedNodes(db, S);
    const sql = flat(queries[0]?.sql);
    assert.ok(sql.includes(`gv.definition -> 'signature'`));
    assert.ok(
      sql.includes(
        '("g"."organization_id" is null or not exists (select "b"."id" from "graphs" as "b" where "b"."key" = "g"."key"'
      )
    );
    assert.ok(sql.includes(visibleTo('b', 5, 6)));
    assert.ok(sql.includes('is not null as "overridden"'));
    assert.deepEqual(queries[0]?.parameters, ['a-1', 'o-1', 'a-1', 'o-1', 'a-1', 'o-1']);
    await db.destroy();
  });

  it('reads versions with the version they were copied from', async () => {
    const { db, queries } = createRecordingDb();
    await listVersions(db, 'g1');
    await findVersion(db, 'g1', 2);
    await findVersionById(db, 'v1');
    await findNewestPublishedVersion(db, 'g1');
    const [list, one, byId, newest] = queries;
    assert.ok(
      list?.sql.includes('left join "graph_versions" as "b" on "b"."id" = "v"."base_version_id"')
    );
    assert.ok(list?.sql.includes('"bg"."id" as "base_graph_id"'));
    assert.ok(one?.sql.includes('"base_version_id"'));
    assert.deepEqual(one?.parameters, ['g1', 2]);
    assert.ok(byId?.sql.includes('as "scope"'));
    assert.ok(newest?.sql.endsWith('"published_at" is not null order by "version" desc limit $2'));
    assert.ok(newest?.sql.includes('"contract"'));
    await db.destroy();
  });
});

describe('graph writes', () => {
  it('numbers versions and publishes drafts only once', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('max(') ? [{ max: null }] : []
    );
    assert.equal(await nextVersion(db, 'g1'), 1);
    await publishVersion(db, 'v1', ['d1']);
    assert.ok(queries[1]?.sql.includes('"published_at" is null'));
    assert.deepEqual(queries[1]?.parameters, [['d1'], 'v1']);
    await db.destroy();
  });

  it('locks and rewrites only the unpublished draft and keeps its contract current', async () => {
    const { db, queries } = createRecordingDb();
    const def = templateFor('node');
    await findDraft(db, 'g1');
    await updateDraft(db, 'v1', def);
    await updateDraft(db, 'v1', def, 'base');
    const [lock, update, rebased] = queries;
    assert.ok(lock?.sql.endsWith('"published_at" is null for update'));
    assert.ok(update?.sql.endsWith('where "id" = $3 and "published_at" is null'));
    assert.deepEqual(update?.parameters, [JSON.stringify(def), contractOf(def.signature), 'v1']);
    assert.ok(rebased?.sql.includes('"base_version_id" = $3'));
    assert.deepEqual(rebased?.parameters.slice(2), ['base', 'v1']);
    await db.destroy();
  });

  it('inserts graphs for an owner and drafts with their contract and base', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'x', version: 1 }]);
    const def = templateFor('workflow');
    await insertGraph(db, {
      organizationId: 'o-1',
      agencyId: null,
      key: 'acme.flow',
      name: 'Flow',
      kind: 'workflow',
      role: 'workflow',
      description: ''
    });
    await insertDraft(db, {
      graphId: 'g1',
      version: 1,
      definition: def,
      baseVersionId: 'b1',
      userId: 'u-1'
    });
    const [graph, draft] = queries;
    assert.deepEqual(graph?.parameters, [
      'o-1',
      null,
      'acme.flow',
      'Flow',
      'workflow',
      'workflow',
      ''
    ]);
    assert.deepEqual(draft?.parameters, [
      'g1',
      1,
      JSON.stringify(def),
      contractOf(def.signature),
      'b1',
      'u-1'
    ]);
    await db.destroy();
  });

  it('finds scoped and built-in graphs, and changes custom graphs only', async () => {
    const { db, queries } = createRecordingDb();
    await findScopedGraph(db, { organizationId: 'o-1', agencyId: null }, 'acme.flow');
    await findScopedGraph(db, { organizationId: 'o-1', agencyId: 'a-1' }, 'acme.flow');
    await setGraphActive(db, 'g1', false);
    await deleteGraph(db, 'g1');
    await findSystemGraph(db, 'acme.flow');
    const [org, agency, toggle, remove, system] = queries;
    assert.ok(
      org?.sql.endsWith('where "organization_id" = $1 and "agency_id" is null and "key" = $2')
    );
    assert.deepEqual(org?.parameters, ['o-1', 'acme.flow']);
    assert.ok(agency?.sql.endsWith('"agency_id" = $2 and "key" = $3'));
    assert.deepEqual(agency?.parameters, ['o-1', 'a-1', 'acme.flow']);
    assert.ok(toggle?.sql.includes('where "id" = $2 and "organization_id" is not null'));
    assert.deepEqual(toggle?.parameters, [false, 'g1']);
    assert.ok(remove?.sql.includes('where "id" = $1 and "organization_id" is not null'));
    assert.ok(system?.sql.endsWith('where "key" = $1 and "organization_id" is null'));
    await db.destroy();
  });
});
