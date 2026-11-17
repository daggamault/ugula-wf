import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findPayerFile, listFileItems, searchPayerFiles } from './queries.ts';

const COLUMNS =
  'select "f"."id", "f"."kind", "f"."file_name", "f"."control_number", "f"."item_count", "f"."problem_count", "f"."created_at", "u"."email" as "uploaded_by"';
const FROM =
  'from "payer_files" as "f" left join "users" as "u" on "u"."id" = "f"."uploaded_by_id" where "f"."agency_id" = $1';

const NO_FACETS = { kind: [], outcome: [] } as const;

const OUTCOME =
  "case when f.problem_count > 0 then 'review' when f.item_count > 0 then 'applied' else 'empty' end";

const isFacet = (sql: string) => sql.includes('group by 1');

const pagesOf = <Q extends { sql: string }>(queries: readonly Q[]) =>
  queries.filter((q) => !isFacet(q.sql));

describe('searchPayerFiles', () => {
  it('pages the agency files with who uploaded them, newest first, without their documents', async () => {
    const { db, queries } = createRecordingDb((q) =>
      isFacet(q.sql) ? [{ value: 'review', label: null, count: '2' }] : [{ id: 'f1', total: '13' }]
    );
    const page = await searchPayerFiles(db, 't-1', {
      page: 2,
      pageSize: 10,
      sort: 'received',
      dir: 'desc',
      ...NO_FACETS
    });
    assert.deepEqual(page, {
      items: [{ id: 'f1' }],
      total: 13,
      page: 2,
      pageSize: 10,
      facets: {
        kind: [{ value: 'review', count: 2 }],
        outcome: [{ value: 'review', count: 2 }]
      }
    });
    const [list, ...rest] = pagesOf(queries);
    assert.equal(
      list?.sql,
      `${COLUMNS}, count(*) over () as "total" ${FROM} order by "f"."created_at" desc nulls last, "f"."id" desc limit $2 offset $3`
    );
    assert.deepEqual(list?.parameters, ['t-1', 10, 10]);
    assert.equal(rest.length, 0);
    await db.destroy();
  });

  it('filters by kind and outcome and counts each under the other', async () => {
    const { db, queries } = createRecordingDb();
    await searchPayerFiles(db, 't-1', {
      page: 1,
      pageSize: 25,
      sort: 'received',
      dir: 'desc',
      kind: ['835'],
      outcome: ['review', 'empty']
    });
    const [list] = pagesOf(queries);
    assert.ok(
      list?.sql.endsWith(
        `${FROM} and "f"."kind" in ($2) and ${OUTCOME} in ($3, $4) order by "f"."created_at" desc nulls last, "f"."id" desc limit $5 offset $6`
      )
    );
    assert.deepEqual(list?.parameters.slice(1, 4), ['835', 'review', 'empty']);
    assert.deepEqual(
      queries.filter((q) => isFacet(q.sql)).map((q) => q.sql),
      [
        `select "f"."kind"::text as "value", null as "label", count(*) as "count" ${FROM} and ${OUTCOME} in ($2, $3) and "f"."kind" is not null group by 1 order by count(*) desc, 1 limit $4`,
        `select ${OUTCOME}::text as "value", null as "label", count(*) as "count" ${FROM} and "f"."kind" in ($2) and ${OUTCOME} is not null group by 1 order by count(*) desc, 1 limit $3`
      ]
    );
    await db.destroy();
  });

  it('sorts by file name ignoring case, kind or problem count', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const page = { page: 1, pageSize: 25, dir: 'asc' } as const;
    for (const sort of ['name', 'kind', 'problems'] as const) {
      await searchPayerFiles(db, 't-1', { ...page, ...NO_FACETS, sort });
    }
    assert.deepEqual(
      pagesOf(queries).map((q) => q.sql.slice(q.sql.lastIndexOf(' order by '))),
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
      dir: 'desc',
      ...NO_FACETS
    });
    assert.deepEqual(page, {
      items: [],
      total: 4,
      page: 2,
      pageSize: 10,
      facets: NO_FACETS
    });
    const count = queries.find((q) => q.sql.startsWith('select count'));
    assert.equal(count?.sql, `select count(*) as "total" ${FROM}`);
    assert.deepEqual(count?.parameters, ['t-1']);
    await db.destroy();
  });
});

describe('findPayerFile', () => {
  it('finds one file with its stored document, payment and matched deposit only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findPayerFile(db, 't-1', 'f1'), undefined);
    assert.equal(
      queries[0]?.sql,
      `${COLUMNS}, "f"."document", "f"."payment_cents", "f"."payment_method", "f"."paid_on", "f"."trace_number", "f"."trace_payer_id", (select "d"."id" from "deposits" as "d" where "d"."payer_file_id" = "f"."id") as "deposit_id" ${FROM} and "f"."id" = $2`
    );
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
