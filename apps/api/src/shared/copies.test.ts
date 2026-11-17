import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { compareCopy, findBaseVersion, overrideCopy } from './copies.ts';
import { fail } from './result.ts';
import { testAccess } from './testing.ts';

const admin = testAccess();
const editor = testAccess(['workflows:read', 'workflows:update']);

const NEWEST = { id: 'v-sys', version: 3, definition: { a: 1 }, contract: 'c' };

const spec = (calls: string[]) => ({
  noun: 'table' as const,
  tier: 'table' as const,
  forbidden: () => fail('forbidden', 'No'),
  insertCopy: async () => {
    calls.push('copy');
    return { id: 'new' };
  },
  insertDraft: async (_: unknown, id: string, from: { id: string }) => {
    calls.push(`draft ${id} from ${from.id}`);
  }
});

describe('findBaseVersion', () => {
  it('bases agency copies on the newest published standard', async () => {
    const { db, queries } = createRecordingDb((q) => {
      if (q.sql.startsWith('select "id" from')) return [{ id: 'sys' }];
      return [NEWEST];
    });
    assert.deepEqual(await findBaseVersion(db, 'data_tables', 'k'), NEWEST);
    assert.equal(queries.at(-1)?.parameters[0], 'sys');
    const none = createRecordingDb();
    assert.equal(await findBaseVersion(none.db, 'graphs', 'k'), undefined);
    assert.equal(none.queries.length, 1);
  });
});

describe('compareCopy', () => {
  it('has nothing to compare for standards and reports a base that moved on', async () => {
    const none = createRecordingDb();
    assert.deepEqual(await compareCopy(none.db, 'graphs', { id: 'g', key: 'k', scope: 'system' }), {
      mine: null,
      copiedFrom: null,
      latest: null,
      baseChanged: false
    });
    assert.equal(none.queries.length, 0);
    const { db } = createRecordingDb((q) => {
      if (q.sql.startsWith('select "id", "version", "definition", "base_version_id"'))
        return [{ id: 'mine', version: 2, definition: {}, base_version_id: 'v-old' }];
      if (q.sql.trimStart().startsWith('select v.id'))
        return [{ id: 'v-old', version: 1, definition: {}, owner_id: 'sys', scope: 'system' }];
      if (q.sql.startsWith('select "id" from')) return [{ id: 'sys' }];
      if (q.sql.includes('"contract"')) return [NEWEST];
      return [];
    });
    const out = await compareCopy(db, 'graphs', { id: 'g', key: 'k', scope: 'agency' });
    assert.deepEqual(out.copiedFrom, {
      ownerId: 'sys',
      scope: 'system',
      version: 1,
      definition: {}
    });
    assert.deepEqual(out.latest, { version: 3, definition: { a: 1 } });
    assert.equal(out.baseChanged, true);
  });

  it('reports an agency item made from scratch as having no base', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "version", "definition", "base_version_id"')
        ? [{ id: 'mine', version: 1, definition: { b: 2 }, base_version_id: null }]
        : []
    );
    assert.deepEqual(await compareCopy(db, 'data_tables', { id: 't', key: 'k', scope: 'agency' }), {
      mine: { version: 1, definition: { b: 2 } },
      copiedFrom: null,
      latest: null,
      baseChanged: false
    });
  });
});

describe('overrideCopy', () => {
  it('copies the newest published version and records it as the base', async () => {
    const calls: string[] = [];
    const { db } = createRecordingDb((q) => (q.sql.includes('"contract"') ? [NEWEST] : []));
    const out = await overrideCopy(
      db,
      'data_tables',
      editor,
      { id: 't', key: 'k', scope: 'system' },
      spec(calls)
    );
    assert.deepEqual(out, { ok: true, value: { id: 'new' } });
    assert.deepEqual(calls, ['copy', 'draft new from v-sys']);
  });

  it('refuses agency copies, missing permission, a second copy and nothing published', async () => {
    const item = { id: 't', key: 'k', scope: 'system' as const };
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "is_active"') ? [{ id: 'c', is_active: true }] : []
    );
    const code = async (access = admin, d = db, it: typeof item | typeof copy = item) => {
      const r = await overrideCopy(d, 'data_tables', access, it, spec([]));
      return r.ok ? 'ok' : r.failure.message;
    };
    const copy = { id: 't', key: 'k', scope: 'agency' as const };
    assert.equal(await code(admin, db, copy), 'This table cannot be overridden for the agency');
    assert.equal(await code(testAccess(['workflows:read'])), 'No');
    assert.equal(await code(), 'This table is already overridden');
    assert.equal(
      await code(admin, createRecordingDb().db),
      'This table has no published version to start from'
    );
  });

  it('turns a switched-off copy back on and reports a copy made meanwhile as taken', async () => {
    const off = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "is_active"') ? [{ id: 'c', is_active: false }] : []
    );
    const item = { id: 't', key: 'k', scope: 'system' as const };
    assert.deepEqual(await overrideCopy(off.db, 'graphs', admin, item, spec([])), {
      ok: true,
      value: { id: 'c' }
    });
    assert.ok(off.queries.some((q) => q.sql.startsWith('update "graphs" set "is_active"')));
    const raced = createRecordingDb((q) => (q.sql.includes('"contract"') ? [NEWEST] : []));
    const out = await overrideCopy(raced.db, 'graphs', admin, item, {
      ...spec([]),
      insertCopy: () => Promise.reject(Object.assign(new Error('pg'), { code: '23505' }))
    });
    assert.deepEqual(out, {
      ok: false,
      failure: { code: 'conflict', message: 'This table is already overridden' }
    });
  });

  it('rethrows other errors from making the copy', async () => {
    const { db } = createRecordingDb((q) => (q.sql.includes('"contract"') ? [NEWEST] : []));
    const item = { id: 't', key: 'k', scope: 'system' as const };
    await assert.rejects(
      overrideCopy(db, 'graphs', admin, item, {
        ...spec([]),
        insertCopy: () => Promise.reject(Object.assign(new Error('pg'), { code: '57014' }))
      }),
      { code: '57014' }
    );
  });
});
