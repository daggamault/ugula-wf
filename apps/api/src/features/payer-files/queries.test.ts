import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findPayerFile, listFileItems, listPayerFiles } from './queries.ts';

describe('payer file queries', () => {
  it('pages the agency files with who uploaded them, newest first by default', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'f1', total: '3' }]);
    const page = await listPayerFiles(db, 't-1', {
      page: 2,
      pageSize: 10,
      sort: 'received',
      dir: 'desc'
    });
    assert.deepEqual(page, { items: [{ id: 'f1' }], total: 3, page: 2, pageSize: 10 });
    const [list] = queries;
    assert.ok(list?.sql.includes('left join "users" as "u" on "u"."id" = "f"."uploaded_by"'));
    assert.ok(list?.sql.includes('"u"."email" as "uploaded_by"'));
    assert.ok(!list?.sql.includes('"f"."document"'));
    assert.ok(list?.sql.includes('where "f"."agency_id" = $1'));
    assert.ok(list?.sql.includes('order by "f"."created_at" desc nulls last, "f"."id" desc'));
    assert.deepEqual(list?.parameters, ['t-1', 10, 10]);
    await db.destroy();
  });

  it('sorts by file name ignoring case, kind or problem count', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const page = { page: 1, pageSize: 25, dir: 'asc' } as const;
    await listPayerFiles(db, 't-1', { ...page, sort: 'name' });
    await listPayerFiles(db, 't-1', { ...page, sort: 'kind' });
    await listPayerFiles(db, 't-1', { ...page, sort: 'problems' });
    assert.ok(queries[0]?.sql.includes('order by lower(f.file_name) asc'));
    assert.ok(queries[1]?.sql.includes('order by "f"."kind" asc'));
    assert.ok(queries[2]?.sql.includes('order by "f"."problem_count" asc'));
    await db.destroy();
  });

  it('finds one file with its stored document only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findPayerFile(db, 't-1', 'f1'), undefined);
    const [find] = queries;
    assert.ok(find?.sql.includes('"f"."document"'));
    assert.ok(find?.sql.includes('where "f"."agency_id" = $1 and "f"."id" = $2'));
    assert.deepEqual(find?.parameters, ['t-1', 'f1']);
    await db.destroy();
  });

  it('lists the items of a file in order with the claims they matched', async () => {
    const { db, queries } = createRecordingDb(() => [{ position: 1 }]);
    assert.deepEqual(await listFileItems(db, 'f1'), [{ position: 1 }]);
    const [items] = queries;
    assert.ok(items?.sql.includes('left join "claims" as "c" on "c"."id" = "i"."claim_id"'));
    assert.ok(items?.sql.includes('"c"."number" as "claim_number"'));
    assert.ok(items?.sql.endsWith('where "i"."file_id" = $1 order by "i"."position"'));
    assert.deepEqual(items?.parameters, ['f1']);
    await db.destroy();
  });
});
