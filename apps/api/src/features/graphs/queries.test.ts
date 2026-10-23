import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import {
  findGraph,
  findVersion,
  listGraphs,
  listPublishedNodes,
  listVersions,
  nextVersion,
  publishVersion
} from './queries.ts';

describe('graph queries', () => {
  it('lists tenant and system graphs with published and draft versions', async () => {
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
        draft: 3
      }
    ]);
    assert.deepEqual(await listGraphs(db, 't-1'), [
      {
        id: 'g1',
        key: 'demo.x',
        name: 'X',
        kind: 'node',
        description: '',
        isSystem: true,
        publishedVersion: 2,
        draftVersion: 3,
        updatedAt: new Date(0)
      }
    ]);
    assert.ok(queries[0]?.sql.includes('filter (where gv.published_at is not null)'));
    assert.ok(queries[0]?.sql.includes('"g"."tenant_id" is null'));
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
