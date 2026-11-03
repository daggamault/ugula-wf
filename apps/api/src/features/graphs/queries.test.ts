import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  findGraph,
  findVersion,
  listPublishedNodes,
  listVersions,
  nextVersion,
  publishVersion,
  searchGraphs
} from './queries.ts';

const BASE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

describe('graph queries', () => {
  it('pages tenant and system graphs with published and draft versions', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        id: 'g1',
        key: 'demo.x',
        name: 'X',
        kind: 'node',
        description: '',
        tenant_id: null,
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
    assert.ok(queries[0]?.sql.includes('"g"."tenant_id" is null'));
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
    assert.ok(mine?.sql.includes('"g"."tenant_id" is not null'));
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
