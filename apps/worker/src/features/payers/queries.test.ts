import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { createPayerStore } from './queries.ts';

const MEDICARE = '0195f2a4-0000-7000-8000-000000000001';
const BLUE = '0195f2a4-0000-7000-8000-000000000002';

const embedder = () => {
  const asked: string[][] = [];
  return {
    asked,
    embed: async (texts: string[]) => {
      asked.push(texts);
      return texts.map((_, i) => [i, 1]);
    }
  };
};

const directory = [
  { id: MEDICARE, name: 'Medicare', claim_filing: 'MB', unembedded: false },
  { id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL', unembedded: true }
];

const medicare = { id: MEDICARE, name: 'Medicare', claimFiling: 'MB' };
const blue = { id: BLUE, name: 'Blue Cross Blue Shield', claimFiling: 'BL' };

describe('createPayerStore', () => {
  it('links directory names and learned aliases without embedding anything', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "payer_aliases"')
        ? [{ alias_key: 'bcbs tx', id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL' }]
        : q.sql.includes('from "payers"')
          ? directory
          : []
    );
    const model = embedder();
    const found = await createPayerStore(db, model).lookup('r1', ['MEDICARE ', 'BCBS-TX']);
    assert.deepEqual(found, [
      { name: 'MEDICARE ', known: medicare, candidates: [] },
      { name: 'BCBS-TX', known: blue, candidates: [] }
    ]);
    assert.equal(model.asked.length, 0);
    const aliasQuery = queries.find((q) => q.sql.includes('from "payer_aliases"'));
    assert.deepEqual(aliasQuery?.parameters, ['r1', 'medicare', 'bcbs tx']);
  });

  it('embeds unembedded directory payers once, then ranks the closest for unknown names', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('order by embedding <=>')
        ? [
            { id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL', similarity: '0.62' },
            { id: MEDICARE, name: 'Medicare', claim_filing: 'MB', similarity: 0.51 }
          ]
        : q.sql.includes('"unembedded"')
          ? directory
          : []
    );
    const model = embedder();
    const [bcbs] = await createPayerStore(db, model).lookup('r1', ['BCBS', 'BCBS']);
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
    const search = queries.find((q) => q.sql.includes('order by embedding <=>'));
    assert.ok(search?.sql.includes('"embedding" is not null'));
    assert.deepEqual(search?.parameters.slice(-1), [8]);
  });

  it('skips the model when nothing is unknown or the directory is empty', async () => {
    const model = embedder();
    const empty = createRecordingDb(() => []);
    assert.deepEqual(await createPayerStore(empty.db, model).lookup('r1', []), []);
    assert.deepEqual(await createPayerStore(empty.db, model).lookup('r1', ['Self Pay']), [
      { name: 'Self Pay', known: null, candidates: [] }
    ]);
    assert.equal(model.asked.length, 0);
  });

  it('learns aliases only for payers in the run tenant directory', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert') && q.parameters.includes(BLUE) ? [{ id: 'a1' }] : []
    );
    const store = createPayerStore(db, embedder());
    await store.linkAlias('r1', 'BCBS TX', BLUE);
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
    await assert.rejects(store.linkAlias('r1', 'BCBS', MEDICARE), /not in the directory/);
    await assert.rejects(store.linkAlias('r1', 'BCBS', 'new'), /not in the directory/);
    await assert.rejects(store.linkAlias('r1', '--', BLUE), /not a payer name/);
  });
});
