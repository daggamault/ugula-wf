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
  setEmbedding,
  upsertPayer
} from './queries.ts';

const PAGE = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;

const MEDICARE = {
  name: 'Medicare',
  payerCode: '00952',
  claimFiling: 'MB',
  filingLimitDays: 90,
  correctionMethod: null,
  appealDays: null,
  planType: null
} as const;

const COLUMNS = `select "p"."id", "p"."name", "p"."payer_code", "p"."claim_filing", "p"."filing_limit_days", "p"."correction_method", "p"."appeal_days", "p"."plan_type", "p"."updated_at", (select coalesce(json_agg(agg), '[]') from (select "a"."id", "a"."alias" from "payer_aliases" as "a" where "a"."payer_id" = "p"."id" order by lower(a.alias)) as agg) as "aliases"`;
const FROM = 'from "payers" as "p" where "p"."agency_id" = $1';
const RETURNING =
  'returning "id", "name", "payer_code", "claim_filing", "filing_limit_days", "correction_method", "appeal_days", "plan_type", "updated_at", embedding is null as "unembedded"';
const INSERT =
  'insert into "payers" ("agency_id", "name", "payer_code", "claim_filing", "filing_limit_days", "correction_method", "appeal_days", "plan_type") values ($1, $2, $3, $4, $5, $6, $7, $8)';
const VALUES = ['t-1', 'Medicare', '00952', 'MB', 90, null, null, null];

describe('searchPayers', () => {
  it('pages the agency payers with their learned names, sorted by name', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'p1', total: '1' }]);
    assert.deepEqual(await searchPayers(db, 't-1', PAGE), {
      items: [{ id: 'p1' }],
      total: 1,
      page: 1,
      pageSize: 25
    });
    assert.equal(
      queries[0]?.sql,
      `${COLUMNS}, count(*) over () as "total" ${FROM} order by lower(p.name) asc nulls last, "p"."id" asc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
    await db.destroy();
  });

  it('searches names, clearinghouse payer IDs and learned names for the escaped text', async () => {
    const { db, queries } = createRecordingDb();
    await searchPayers(db, 't-1', { ...PAGE, sort: 'payerCode', dir: 'desc', q: ' Blue%' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${FROM} and (lower(p.name) like $2 or lower(p.payer_code) like $3 or exists (select "m"."id" from "payer_aliases" as "m" where "m"."payer_id" = "p"."id" and lower(m.alias) like $4)) order by lower(p.payer_code) desc nulls last, "p"."id" desc limit $5 offset $6`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%blue\\%%', '%blue\\%%', '%blue\\%%', 25, 0]);
    await db.destroy();
  });

  it('sorts by claim filing indicator', async () => {
    const { db, queries } = createRecordingDb();
    await searchPayers(db, 't-1', { ...PAGE, sort: 'filing' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${FROM} order by "p"."claim_filing" asc nulls last, "p"."id" asc limit $2 offset $3`
      )
    );
    await db.destroy();
  });
});

describe('findPayer', () => {
  it('finds one payer with its learned names within the agency', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findPayer(db, 't-1', 'p1'), undefined);
    assert.equal(queries[0]?.sql, `${COLUMNS} ${FROM} and "p"."id" = $2`);
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'p1']);
    await db.destroy();
  });
});

describe('listPayerNames', () => {
  it('lists a bounded set of the agency payer names', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'p1', name: 'Medicare' }]);
    assert.deepEqual(await listPayerNames(db, 't-1'), [{ id: 'p1', name: 'Medicare' }]);
    assert.equal(
      queries[0]?.sql,
      'select "id", "name" from "payers" where "agency_id" = $1 order by lower(name) limit $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 50]);
    await db.destroy();
  });

  it('lists the payer names containing the text', async () => {
    const { db, queries } = createRecordingDb();
    await listPayerNames(db, 't-1', ' Med ');
    assert.equal(
      queries[0]?.sql,
      'select "id", "name" from "payers" where "agency_id" = $1 and lower(name) like $2 order by lower(name) limit $3'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%med%', 50]);
    await db.destroy();
  });
});

describe('upsertPayer', () => {
  it('inserts or updates by name ignoring case, keeping the embedding while the filing holds', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'p1' }]);
    assert.deepEqual(await upsertPayer(db, 't-1', MEDICARE, { create: true, update: true }), {
      id: 'p1'
    });
    assert.equal(
      queries[0]?.sql,
      `${INSERT} on conflict (agency_id, lower(name)) do update set "payer_code" = $9, "claim_filing" = $10, "filing_limit_days" = $11, "correction_method" = $12, "appeal_days" = $13, "plan_type" = $14, "updated_at" = now(), "embedding" = case when payers.claim_filing = excluded.claim_filing then payers.embedding end ${RETURNING}`
    );
    assert.deepEqual(queries[0]?.parameters, [...VALUES, ...VALUES.slice(2)]);
    await db.destroy();
  });

  it('only inserts a new name without update', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(
      await upsertPayer(db, 't-1', MEDICARE, { create: true, update: false }),
      undefined
    );
    assert.equal(
      queries[0]?.sql,
      `${INSERT} on conflict (agency_id, lower(name)) do nothing ${RETURNING}`
    );
    assert.deepEqual(queries[0]?.parameters, VALUES);
    await db.destroy();
  });

  it('only updates the same name without create', async () => {
    const { db, queries } = createRecordingDb();
    await upsertPayer(db, 't-1', MEDICARE, { create: false, update: true });
    assert.equal(
      queries[0]?.sql,
      `update "payers" set "payer_code" = $1, "claim_filing" = $2, "filing_limit_days" = $3, "correction_method" = $4, "appeal_days" = $5, "plan_type" = $6, "updated_at" = now(), "embedding" = case when claim_filing = $7 then embedding end where "agency_id" = $8 and lower(name) = $9 ${RETURNING}`
    );
    assert.deepEqual(queries[0]?.parameters, [
      '00952',
      'MB',
      90,
      null,
      null,
      null,
      'MB',
      't-1',
      'medicare'
    ]);
    await db.destroy();
  });
});

describe('payer deletes', () => {
  it('deletes a payer within the agency and reports whether it was there', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.parameters[0] === 'p1' ? [{ id: 'p1' }] : []
    );
    assert.equal(await deletePayer(db, 't-1', 'p1'), true);
    assert.equal(await deletePayer(db, 't-1', 'p2'), false);
    assert.equal(
      queries[0]?.sql,
      'delete from "payers" where "id" = $1 and "agency_id" = $2 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['p1', 't-1']);
    await db.destroy();
  });

  it('forgets a learned payer name only within its payer and agency', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.parameters[0] === 'a1' ? [{ id: 'a1' }] : []
    );
    assert.equal(await deleteAlias(db, 't-1', 'p1', 'a1'), true);
    assert.equal(await deleteAlias(db, 't-1', 'p1', 'a2'), false);
    assert.equal(
      queries[0]?.sql,
      'delete from "payer_aliases" where "id" = $1 and "payer_id" = $2 and "agency_id" = $3 returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['a1', 'p1', 't-1']);
    await db.destroy();
  });
});

describe('linkCoverages', () => {
  it('links unlinked claim coverages of the agency to a payer by name and counts them', async () => {
    const { db, queries } = createRecordingDb(() => [{ claim_id: 'c1' }, { claim_id: 'c2' }]);
    assert.equal(await linkCoverages(db, 't-1', { id: 'p1', name: 'MediCare' }), 2);
    assert.equal(
      queries[0]?.sql,
      'update "claim_coverages" as "cc" set "payer_id" = $1 from "claims" as "c" where "c"."id" = "cc"."claim_id" and "c"."agency_id" = $2 and "cc"."payer_id" is null and lower(cc.payer_name) = $3 returning "cc"."claim_id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['p1', 't-1', 'medicare']);
    await db.destroy();
  });

  it('counts nothing when no coverage matches', async () => {
    const { db } = createRecordingDb();
    assert.equal(await linkCoverages(db, 't-1', { id: 'p1', name: 'Medicare' }), 0);
    await db.destroy();
  });
});

describe('setEmbedding', () => {
  it('saves an embedding only for an unembedded payer of the agency', async () => {
    const { db, queries } = createRecordingDb();
    await setEmbedding(db, 't-1', 'p1', [0.5, -1]);
    assert.equal(
      queries[0]?.sql,
      'update "payers" set "embedding" = $1::vector where "id" = $2 and "agency_id" = $3 and "embedding" is null'
    );
    assert.deepEqual(queries[0]?.parameters, ['[0.5,-1]', 'p1', 't-1']);
    await db.destroy();
  });
});
