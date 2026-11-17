import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findPayerFile, listFileItems, searchPayerFiles } from './queries.ts';

const COLUMNS =
  'select "f"."id", "f"."kind", "f"."file_name", "f"."control_number", "f"."item_count", "f"."problem_count", "f"."created_at", "u"."email" as "uploaded_by"';
const FROM =
  'from "payer_files" as "f" left join "users" as "u" on "u"."id" = "f"."uploaded_by_id" where "f"."agency_id" = $1';

describe('searchPayerFiles', () => {
  it('pages the agency files with who uploaded them, newest first, without their documents', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'f1', total: '13' }]);
    const page = await searchPayerFiles(db, 't-1', {
      page: 2,
      pageSize: 10,
      sort: 'received',
      dir: 'desc'
    });
    assert.deepEqual(page, { items: [{ id: 'f1' }], total: 13, page: 2, pageSize: 10 });
    assert.equal(
      queries[0]?.sql,
      `${COLUMNS}, count(*) over () as "total" ${FROM} order by "f"."created_at" desc nulls last, "f"."id" desc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 10, 10]);
    assert.equal(queries.length, 1);
    await db.destroy();
  });

  it('sorts by file name ignoring case, kind or problem count', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const page = { page: 1, pageSize: 25, dir: 'asc' } as const;
    for (const sort of ['name', 'kind', 'problems'] as const) {
      await searchPayerFiles(db, 't-1', { ...page, sort });
    }
    assert.deepEqual(
      queries.map((q) => q.sql.slice(q.sql.lastIndexOf(' order by '))),
      ['lower(f.file_name)', '"f"."kind"', '"f"."problem_count"'].map(
        (by) => ` order by ${by} asc nulls last, "f"."id" asc limit $2 offset $3`
      )
    );
    await db.destroy();
  });

  it('counts the agency files when a later page is empty', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select count') ? [{ total: '4' }] : []
    );
    const page = await searchPayerFiles(db, 't-1', {
      page: 2,
      pageSize: 10,
      sort: 'received',
      dir: 'desc'
    });
    assert.deepEqual(page, { items: [], total: 4, page: 2, pageSize: 10 });
    assert.equal(queries[1]?.sql, `select count(*) as "total" ${FROM}`);
    assert.deepEqual(queries[1]?.parameters, ['t-1']);
    await db.destroy();
  });
});

describe('findPayerFile', () => {
  it('finds one file with its stored document only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findPayerFile(db, 't-1', 'f1'), undefined);
    assert.equal(queries[0]?.sql, `${COLUMNS}, "f"."document" ${FROM} and "f"."id" = $2`);
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'f1']);
    await db.destroy();
  });
});

describe('listFileItems', () => {
  it('lists the items of a file in order with the claims they matched', async () => {
    const { db, queries } = createRecordingDb(() => [{ position: 1 }]);
    assert.deepEqual(await listFileItems(db, 'f1'), [{ position: 1 }]);
    assert.equal(
      queries[0]?.sql,
      'select "i"."position", "i"."reference", "i"."claim_id", "c"."number" as "claim_number", "i"."outcome", "i"."message", "i"."paid_cents", "i"."adjusted_cents" from "payer_file_items" as "i" left join "claims" as "c" on "c"."id" = "i"."claim_id" where "i"."file_id" = $1 order by "i"."position"'
    );
    assert.deepEqual(queries[0]?.parameters, ['f1']);
    await db.destroy();
  });
});
