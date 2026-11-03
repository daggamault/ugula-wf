import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import {
  deleteAlias,
  deletePayer,
  findPayer,
  linkCoverages,
  listPayerNames,
  searchPayers,
  upsertPayer
} from './queries.ts';

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

describe('payer queries', () => {
  it('pages payers with their learned names, sorted by name', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'p1', total: '1' }]);
    const page = await searchPayers(db, 't-1', PAGE);
    assert.equal(page.total, 1);
    const [list] = queries;
    assert.ok(
      list?.sql.includes(
        '(select coalesce(json_agg(agg), \'[]\') from (select "a"."id", "a"."alias" from "payer_aliases" as "a" where "a"."payer_id" = "p"."id" order by lower(a.alias)) as agg) as "aliases"'
      )
    );
    assert.ok(list?.sql.includes('order by lower(p.name) asc nulls last'));
    assert.deepEqual(list?.parameters, ['t-1', 25, 0]);
  });

  it('searches names, clearinghouse payer IDs and learned names for the text', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchPayers(db, 't-1', { ...PAGE, sort: 'payerId', dir: 'desc', q: ' Blue%' });
    const [list] = queries;
    assert.ok(list?.sql.includes('lower(p.name) like $2'));
    assert.ok(list?.sql.includes('lower(p.payer_id) like $3'));
    assert.ok(list?.sql.includes('exists (select "m"."id" from "payer_aliases" as "m"'));
    assert.ok(list?.sql.includes('order by lower(p.payer_id) desc nulls last'));
    assert.deepEqual(list?.parameters.slice(1, 4), ['%blue\\%%', '%blue\\%%', '%blue\\%%']);
  });

  it('finds one payer and lists every payer name within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findPayer(db, 't-1', 'p1'), undefined);
    await listPayerNames(db, 't-1');
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'p1']);
    assert.ok(queries[1]?.sql.endsWith('order by lower(name)'));
  });

  it('upserts by name ignoring case and deletes within the tenant', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('delete') ? [] : [{ id: 'p1' }]
    );
    await upsertPayer(db, 't-1', { name: 'Medicare', payerId: '00952', claimFiling: 'MB' });
    assert.equal(await deletePayer(db, 't-1', 'p1'), false);
    const [upsert, remove] = queries;
    assert.ok(upsert?.sql.includes('on conflict (tenant_id, lower(name)) do update set'));
    assert.ok(
      upsert?.sql.includes(
        '"embedding" = case when payers.claim_filing = excluded.claim_filing then payers.embedding end'
      )
    );
    assert.deepEqual(remove?.parameters, ['p1', 't-1']);
    await db.destroy();
  });

  it('forgets a learned payer name only within its payer and tenant', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'a1' }]);
    assert.equal(await deleteAlias(db, 't-1', 'p1', 'a1'), true);
    assert.ok(queries[0]?.sql.startsWith('delete from "payer_aliases" where "id" = $1'));
    assert.deepEqual(queries[0]?.parameters, ['a1', 'p1', 't-1']);
    await db.destroy();
  });

  it('links unlinked claim coverages of the tenant to a payer by name', async () => {
    const { db, queries } = createRecordingDb(() => [{ claim_id: 'c1' }, { claim_id: 'c2' }]);
    assert.equal(await linkCoverages(db, 't-1', { id: 'p1', name: 'MediCare' }), 2);
    const [link] = queries;
    assert.ok(
      link?.sql.startsWith(
        'update "claim_coverages" as "cc" set "payer_id" = $1 from "claims" as "c" where "c"."id" = "cc"."claim_id"'
      )
    );
    assert.ok(link?.sql.includes('"cc"."payer_id" is null'));
    assert.deepEqual(link?.parameters, ['p1', 't-1', 'medicare']);
  });
});
