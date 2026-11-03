import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
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
    assert.ok(known?.sql.includes('from payer_aliases a'));
    assert.ok(known?.sql.includes('normalize(lower(p.name), NFKD)'));
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
    const update = queries.find((q) => q.sql.startsWith('update "payers"'));
    assert.ok(update?.sql.includes('from (values ($1::uuid, $2::vector)) as v(id, embedding)'));
    assert.deepEqual(update?.parameters, [BLUE, '[0,1]']);
    const search = queries.filter((q) => q.sql.includes('with ordinality'));
    assert.equal(search.length, 1);
    assert.ok(search[0]?.sql.includes('embedding is not null'));
    assert.deepEqual(search[0]?.parameters.slice(0, 1), [['[0,1]']]);
    assert.deepEqual(search[0]?.parameters.slice(-1), [8]);
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

  it('learns aliases only for payers in the run tenant directory', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert') && q.parameters.includes(BLUE) ? [{ id: 'a1' }] : []
    );
    const store = createPayerStore(db, embedder());
    assert.equal(await store.linkAlias('r1', 'BCBS TX', BLUE), true);
    const [insert] = queries;
    assert.ok(
      insert?.sql.startsWith(
        'insert into "payer_aliases" ("tenant_id", "payer_id", "alias", "alias_key") select "tenant_id", "id"'
      )
    );
    assert.ok(
      insert?.sql.includes(
        'on conflict ("tenant_id", "alias_key") do update set "payer_id" = "excluded"."payer_id", "alias" = "excluded"."alias"'
      )
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

  it('lists the tenant directory by name', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL' }
    ]);
    assert.deepEqual(await createPayerStore(db, embedder()).directory('r1'), [blue]);
    assert.ok(
      queries[0]?.sql.includes('where "p"."tenant_id" = (select "tenant_id" from "workflow_runs"')
    );
    assert.match(queries[0]?.sql ?? '', /order by "p"."name"/);
  });

  it('caches suggestions per name key and directory version', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "payer_id"') && q.parameters.includes('bcbs tx')
        ? [{ payer_id: null }]
        : []
    );
    const store = createPayerStore(db, embedder());
    assert.equal(await store.cachedSuggestion('r1', 'BCBS-TX'), null);
    assert.equal(await store.cachedSuggestion('r1', 'Aetna'), undefined);
    assert.ok(queries[0]?.sql.includes('"directory_version" = (select md5('));
    await store.cacheSuggestion('r1', 'BCBS-TX', BLUE);
    const insert = queries.at(-1);
    assert.match(insert?.sql ?? '', /^insert into "payer_suggestions"/);
    assert.ok(
      insert?.sql.includes(
        'on conflict ("tenant_id", "name_key", "directory_version") do update set "payer_id" = "excluded"."payer_id"'
      )
    );
    assert.ok(insert?.parameters.includes('bcbs tx'));
    assert.ok(insert?.parameters.includes(BLUE));
  });
});
