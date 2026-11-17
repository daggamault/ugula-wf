import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { EMBED_BATCH_SIZE } from '@ugula/inference';
import { createPayerStore } from './queries.ts';

const MEDICARE = '0195f2a4-0000-7000-8000-000000000001';
const BLUE = '0195f2a4-0000-7000-8000-000000000002';

const embedder = (short = false) => {
  const asked: string[][] = [];
  return {
    asked,
    embed: async (texts: string[]) => {
      asked.push(texts);
      return texts.slice(short ? 1 : 0).map((_, i) => [i, 1]);
    }
  };
};

const medicare = { id: MEDICARE, name: 'Medicare', claimFiling: 'MB' };
const blue = { id: BLUE, name: 'Blue Cross Blue Shield', claimFiling: 'BL' };

const unmatched = (key: string) => ({
  key,
  id: null,
  name: null,
  claim_filing: null,
  stocked: true
});

describe('createPayerStore', () => {
  it('links directory names and learned aliases in one query without embedding anything', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from unnest')
        ? [
            { key: 'medicare', id: MEDICARE, name: 'Medicare', claim_filing: 'MB', stocked: true },
            {
              key: 'bcbs tx',
              id: BLUE,
              name: 'Blue Cross Blue Shield',
              claim_filing: 'BL',
              stocked: true
            }
          ]
        : []
    );
    const model = embedder();
    const found = await createPayerStore(db, model).lookup('r1', ['MEDICARE ', 'BCBS-TX'], true);
    assert.deepEqual(found, [
      { name: 'MEDICARE ', known: medicare, candidates: [] },
      { name: 'BCBS-TX', known: blue, candidates: [] }
    ]);
    assert.equal(model.asked.length, 0);
    assert.equal(queries.length, 1);
    const [known] = queries;
    const sql = known?.sql.replace(/\s+/g, ' ').trim();
    assert.match(
      sql ?? '',
      /^with t as \(select agency_id from workflow_runs where id = \$1\) select k\.key, m\.id, m\.name, m\.claim_filing, exists \(select 1 from payers p join t on t\.agency_id = p\.agency_id\) as stocked from unnest\(\$2::text\[\]\) as k\(key\)/
    );
    assert.match(
      sql ?? '',
      /select p\.id, p\.name, p\.claim_filing, 0 as rank from payers p join t on t\.agency_id = p\.agency_id where trim\(.*normalize\(lower\(p\.name\), NFKD\).*\) = k\.key union all select p\.id, p\.name, p\.claim_filing, 1 as rank from payer_aliases a join t on t\.agency_id = a\.agency_id join payers p on p\.id = a\.payer_id where a\.alias_key = k\.key \) matched order by rank limit 1 \) m on true$/
    );
    assert.deepEqual(known?.parameters, ['r1', ['medicare', 'bcbs tx']]);
  });

  it('embeds pending directory payers as its own step, then ranks every unknown name in one query', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('with ordinality')
        ? [
            { ord: '1', ...blue, claim_filing: 'BL', similarity: '0.62' },
            { ord: '1', ...medicare, claim_filing: 'MB', similarity: 0.51 }
          ]
        : q.sql.includes('from unnest')
          ? [unmatched('bcbs')]
          : q.sql.includes('"embedding" is null')
            ? [{ id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL' }]
            : []
    );
    const model = embedder();
    const [bcbs] = await createPayerStore(db, model).lookup('r1', ['BCBS', 'BCBS'], true);
    assert.deepEqual(bcbs, {
      name: 'BCBS',
      known: null,
      candidates: [
        { ...blue, similarity: 0.62 },
        { ...medicare, similarity: 0.51 }
      ]
    });
    assert.deepEqual(model.asked[0], ['Blue Cross Blue Shield (Blue Cross/Blue Shield)']);
    assert.match(model.asked[1]?.[0] ?? '', /Query: BCBS$/);
    assert.equal(model.asked[1]?.length, 1);
    const [, pending, update, search] = queries;
    assert.deepEqual(
      [pending?.sql, pending?.parameters],
      [
        'select "id", "name", "claim_filing" from "payers" where "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1) and "embedding" is null limit $2 for update',
        ['r1', EMBED_BATCH_SIZE]
      ]
    );
    assert.deepEqual(
      [update?.sql, update?.parameters],
      [
        'update "payers" as "p" set "embedding" = v.embedding from (values ($1::uuid, $2::vector)) as v(id, embedding) where "p"."id" = "v"."id"',
        [BLUE, '[0,1]']
      ]
    );
    assert.equal(
      search?.sql.replace(/\s+/g, ' ').trim(),
      'select q.ord, c.id, c.name, c.claim_filing, c.similarity from unnest($1::text[]) with ordinality as q(v, ord) cross join lateral ( select id, name, claim_filing, 1 - (embedding <=> q.v::vector) as similarity from payers where agency_id = (select "agency_id" from "workflow_runs" where "id" = $2) and embedding is not null order by embedding <=> q.v::vector limit $3 ) c order by q.ord, c.similarity desc'
    );
    assert.deepEqual(search?.parameters, [['[0,1]'], 'r1', 8]);
    assert.equal(queries.length, 4);
  });

  it('fails clearly when the embeddings service returns too few vectors', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from unnest') ? [unmatched('bcbs')] : []
    );
    await assert.rejects(
      () => createPayerStore(db, embedder(true)).lookup('r1', ['BCBS'], true),
      /returned 0 vectors for 1 texts/
    );
  });

  it('skips the model when nothing is unknown or the directory is empty', async () => {
    const model = embedder();
    const empty = createRecordingDb((q) =>
      q.sql.includes('from unnest') ? [{ ...unmatched('self pay'), stocked: false }] : []
    );
    assert.deepEqual(await createPayerStore(empty.db, model).lookup('r1', [], true), []);
    assert.deepEqual(await createPayerStore(empty.db, model).lookup('r1', ['Self Pay'], true), [
      { name: 'Self Pay', known: null, candidates: [] }
    ]);
    assert.equal(model.asked.length, 0);
    assert.equal(empty.queries.length, 1);
  });

  it('learns aliases only for payers in the run agency directory', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert') && q.parameters.includes(BLUE) ? [{ id: 'a1' }] : []
    );
    const store = createPayerStore(db, embedder());
    assert.equal(await store.linkAlias('r1', 'BCBS TX', BLUE), true);
    const [insert] = queries;
    assert.equal(
      insert?.sql,
      'insert into "payer_aliases" ("agency_id", "payer_id", "alias", "alias_key") select "agency_id", "id", $1::text as "alias", $2::text as "alias_key" from "payers" where "id" = $3 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $4) on conflict ("agency_id", "alias_key") do update set "payer_id" = "excluded"."payer_id", "alias" = "excluded"."alias" returning "id"'
    );
    assert.deepEqual(insert?.parameters, ['BCBS TX', 'bcbs tx', BLUE, 'r1']);
    assert.equal(await store.linkAlias('r1', 'BCBS', MEDICARE), false);
    assert.equal(await store.linkAlias('r1', 'BCBS', 'new'), false);
    assert.equal(await store.linkAlias('r1', '--', BLUE), false);
    assert.equal(queries.length, 2);
  });

  it('skips the similarity search when asked for exact and learned names only', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from unnest') ? [unmatched('bcbs')] : []
    );
    const model = embedder();
    assert.deepEqual(await createPayerStore(db, model).lookup('r1', ['BCBS'], false), [
      { name: 'BCBS', known: null, candidates: [] }
    ]);
    assert.equal(model.asked.length, 0);
    assert.equal(queries.length, 1);
  });

  it('ranks several unknown names at once, skipping embedding when every payer has a vector', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('with ordinality')
        ? [
            { ord: '2', ...medicare, claim_filing: 'MB', similarity: 0.7 },
            { ord: '3', ...blue, claim_filing: 'BL', similarity: 0.9 }
          ]
        : q.sql.includes('from unnest')
          ? [unmatched('mcr'), unmatched('bcbs')]
          : []
    );
    const model = embedder();
    const found = await createPayerStore(db, model).lookup('r1', ['BCBS', 'MCR'], true);
    assert.deepEqual(found, [
      { name: 'BCBS', known: null, candidates: [] },
      { name: 'MCR', known: null, candidates: [{ ...medicare, similarity: 0.7 }] }
    ]);
    assert.equal(model.asked.length, 1);
    assert.equal(model.asked[0]?.length, 2);
    assert.ok(!queries.some((q) => q.sql.startsWith('update')));
  });

  it('treats a match missing its name or claim filing as unknown', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from unnest')
        ? [
            { ...unmatched('medicare'), id: MEDICARE, name: 'Medicare' },
            { ...unmatched('bcbs'), id: BLUE, claim_filing: 'BL' }
          ]
        : []
    );
    assert.deepEqual(
      await createPayerStore(db, embedder()).lookup('r1', ['Medicare', 'BCBS'], false),
      [
        { name: 'Medicare', known: null, candidates: [] },
        { name: 'BCBS', known: null, candidates: [] }
      ]
    );
  });

  it('lists the agency directory by name, then id', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL' },
      { id: MEDICARE, name: 'Medicare', claim_filing: 'MB' }
    ]);
    assert.deepEqual(await createPayerStore(db, embedder()).directory('r1'), [blue, medicare]);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'select "p"."id", "p"."name", "p"."claim_filing" from "payers" as "p" where "p"."agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1) order by "p"."name", "p"."id"',
          ['r1']
        ]
      ]
    );
  });

  const VERSION = (n: number) =>
    `(select md5(coalesce(string_agg(id::text || ':' || updated_at::text, ',' order by id), '')) as "version" from "payers" where "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $${n}))`;

  it('reads a cached suggestion for the name key at the current directory version', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.parameters.includes('bcbs tx')
        ? [{ payer_id: BLUE }]
        : q.parameters.includes('mcr')
          ? [{ payer_id: null }]
          : []
    );
    const store = createPayerStore(db, embedder());
    assert.equal(await store.cachedSuggestion('r1', 'BCBS-TX'), BLUE);
    assert.equal(await store.cachedSuggestion('r1', 'MCR'), null);
    assert.equal(await store.cachedSuggestion('r1', 'Aetna'), undefined);
    assert.deepEqual(
      [queries[0]?.sql, queries[0]?.parameters],
      [
        `select "payer_id" from "payer_suggestions" where "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1) and "name_key" = $2 and "directory_version" = ${VERSION(3)}`,
        ['r1', 'bcbs tx', 'r1']
      ]
    );
  });

  const CACHE = (payer: string, run: number) =>
    `insert into "payer_suggestions" ("agency_id", "name_key", "directory_version", "payer_id") select "r"."agency_id", $1::text as "name_key", ${VERSION(2)} as "directory_version", ${payer} as "payer_id" from "workflow_runs" as "r" where "r"."id" = $${run} on conflict ("agency_id", "name_key", "directory_version") do update set "payer_id" = "excluded"."payer_id"`;

  it("caches a suggestion per name key and directory version, keeping only the agency's own payer", async () => {
    const { db, queries } = createRecordingDb();
    const store = createPayerStore(db, embedder());
    await store.cacheSuggestion('r1', 'BCBS-TX', BLUE);
    assert.deepEqual(
      [queries[0]?.sql, queries[0]?.parameters],
      [
        CACHE(
          '(select "p"."id" from "payers" as "p" where "p"."agency_id" = "r"."agency_id" and "p"."id" = $3)',
          4
        ),
        ['bcbs tx', 'r1', BLUE, 'r1']
      ]
    );
  });

  it('caches no suggestion as null, for no payer or an id that is not a UUID, and skips blank names', async () => {
    const { db, queries } = createRecordingDb();
    const store = createPayerStore(db, embedder());
    await store.cacheSuggestion('r1', 'BCBS-TX', null);
    await store.cacheSuggestion('r1', 'BCBS-TX', 'MCR');
    await store.cacheSuggestion('r1', '--', BLUE);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [CACHE('null::uuid', 3), ['bcbs tx', 'r1', 'r1']],
        [CACHE('null::uuid', 3), ['bcbs tx', 'r1', 'r1']]
      ]
    );
  });
});
