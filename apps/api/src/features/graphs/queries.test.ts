import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteGraph,
  findAgencyGraph,
  findGraph,
  findSystemGraph,
  findVersion,
  listPublishedNodes,
  listVersions,
  lockDraft,
  nextVersion,
  publishVersion,
  searchGraphs,
  setGraphActive,
  updateDraft
} from './queries.ts';
import { templateFor } from './service.ts';

const BASE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

describe('graph queries', () => {
  it('pages agency and system graphs with published and draft versions', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        id: 'g1',
        key: 'demo.x',
        name: 'X',
        kind: 'node',
        description: '',
        agency_id: null,
        updated_at: new Date(0),
        published: 2,
        draft: 3,
        overrides: false,
        overridden_by: 'g2',
        total: '1'
      }
    ]);
    const page = await searchGraphs(db, 't-1', { ...BASE, show: 'all' });
    assert.equal(page.total, 1);
    assert.deepEqual(page.items, [
      {
        id: 'g1',
        key: 'demo.x',
        name: 'X',
        kind: 'node',
        description: '',
        isSystem: true,
        overrides: false,
        overriddenBy: 'g2',
        publishedVersion: 2,
        draftVersion: 3,
        updatedAt: new Date(0)
      }
    ]);
    assert.ok(
      queries[0]?.sql.includes(
        'left join lateral (select max(gv.version) filter (where gv.published_at is not null)'
      )
    );
    assert.ok(queries[0]?.sql.includes('"g"."agency_id" is null'));
    assert.ok(queries[0]?.sql.includes('order by lower(g.name) asc nulls last'));
    await db.destroy();
  });

  it('searches names and keys of the kind shown', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const base = { ...BASE, sort: 'kind', dir: 'desc' } as const;
    await searchGraphs(db, 't-1', { ...base, show: 'blocks', q: 'Match' });
    await searchGraphs(db, 't-1', { ...base, show: 'mine' });
    await searchGraphs(db, 't-1', { ...base, show: 'workflows' });
    const [blocks, mine, workflows] = queries;
    assert.ok(blocks?.sql.includes('"g"."kind" != $'));
    assert.ok(blocks?.sql.includes('lower(g.name) like $'));
    assert.ok(blocks?.sql.includes('lower(g.key) like $'));
    assert.ok(blocks?.parameters.includes('%match%'));
    assert.ok(blocks?.sql.includes('order by (g.kind, lower(g.name)) desc nulls last'));
    assert.ok(mine?.sql.includes('"g"."agency_id" is not null'));
    assert.ok(workflows?.sql.includes('"g"."kind" = $'));
    await db.destroy();
  });

  it('numbers versions and publishes drafts only once', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('max(') ? [{ max: null }] : []
    );
    assert.equal(await nextVersion(db, 'g1'), 1);
    await publishVersion(db, 'v1', ['d1']);
    assert.ok(queries[1]?.sql.includes('"published_at" is null'));
    await db.destroy();
  });

  it('reads graphs, versions and catalog signatures', async () => {
    const { db, queries } = createRecordingDb();
    await listPublishedNodes(db, 't-1');
    await findGraph(db, 't-1', 'g1');
    await listVersions(db, 'g1');
    await findVersion(db, 'g1', 2);
    assert.ok(queries[0]?.sql.includes(`gv.definition -> 'signature'`));
    assert.equal(queries.length, 4);
    await db.destroy();
  });
});

describe('graph agency scoping', () => {
  it('reads system graphs and active graphs of the agency only', async () => {
    const { db, queries } = createRecordingDb();
    await findGraph(db, 't-1', 'g1');
    assert.ok(
      queries[0]?.sql.includes(
        '("g"."agency_id" is null or ("g"."agency_id" = $3 and "g"."is_active" = $4))'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'g1', 't-1', true]);
    await searchGraphs(db, 't-1', { ...BASE, show: 'all' });
    assert.ok(
      queries[1]?.sql.includes(
        '("g"."agency_id" is null or ("g"."agency_id" = $2 and "g"."is_active" = $3))'
      )
    );
    assert.deepEqual(queries[1]?.parameters.slice(0, 3), ['t-1', 't-1', true]);
    await db.destroy();
  });

  it('lists system nodes and agency nodes that do not shadow a system key', async () => {
    const { db, queries } = createRecordingDb();
    await listPublishedNodes(db, 't-1');
    assert.ok(
      queries[0]?.sql.includes(
        '("g"."agency_id" is null or ("g"."agency_id" = $1 and not exists (select "s"."id" from "graphs" as "s" where "s"."key" = "g"."key" and "s"."agency_id" is null)))'
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1']);
    await db.destroy();
  });

  it('changes and removes graphs of the agency only', async () => {
    const { db, queries } = createRecordingDb();
    await findAgencyGraph(db, 't-1', 'acme.flow');
    await setGraphActive(db, 't-1', 'g1', false);
    await deleteGraph(db, 't-1', 'g1');
    await findSystemGraph(db, 'acme.flow');
    const [copy, toggle, remove, system] = queries;
    assert.ok(copy?.sql.endsWith('where "agency_id" = $1 and "key" = $2'));
    assert.deepEqual(copy?.parameters, ['t-1', 'acme.flow']);
    assert.ok(toggle?.sql.includes('where "id" = $2 and "agency_id" = $3'));
    assert.deepEqual(toggle?.parameters, [false, 'g1', 't-1']);
    assert.ok(remove?.sql.includes('where "id" = $1 and "agency_id" = $2'));
    assert.deepEqual(remove?.parameters, ['g1', 't-1']);
    assert.ok(system?.sql.endsWith('where "key" = $1 and "agency_id" is null'));
    await db.destroy();
  });

  it('locks and rewrites only the unpublished draft', async () => {
    const { db, queries } = createRecordingDb();
    await lockDraft(db, 'g1');
    await updateDraft(db, 'v1', templateFor('node'));
    assert.ok(queries[0]?.sql.endsWith('"published_at" is null for update'));
    assert.ok(queries[1]?.sql.endsWith('where "id" = $2 and "published_at" is null'));
    assert.deepEqual(queries[1]?.parameters, [JSON.stringify(templateFor('node')), 'v1']);
    await db.destroy();
  });
});
