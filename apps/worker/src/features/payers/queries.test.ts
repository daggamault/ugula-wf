import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createPayerStore } from './queries.ts';

const MEDICARE = '0195f2a4-0000-7000-8000-000000000001';
const BLUE = '0195f2a4-0000-7000-8000-000000000002';

describe('createPayerStore', () => {
  it('finds a payer by its directory name or a linked name in one query', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('payer_aliases')
        ? [{ id: MEDICARE, name: 'Medicare', claim_filing: 'MB' }]
        : []
    );
    const found = await createPayerStore(db).findPayer('r1', ' MEDICARE ');
    assert.deepEqual(found, {
      known: { id: MEDICARE, name: 'Medicare', claimFiling: 'MB' },
      similar: []
    });
    assert.equal(queries.length, 1);
    assert.deepEqual(queries[0]?.parameters, ['r1', 'medicare', 'medicare']);
  });

  it('offers payers with similar names when none is linked', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('similarity(')
        ? [{ id: BLUE, name: 'Blue Cross Blue Shield', claim_filing: 'BL', similarity: '0.42' }]
        : []
    );
    const found = await createPayerStore(db).findPayer('r1', 'Blue Cross');
    assert.deepEqual(found, {
      known: null,
      similar: [{ id: BLUE, name: 'Blue Cross Blue Shield', claimFiling: 'BL', similarity: 0.42 }]
    });
    assert.equal(queries.length, 2);
  });

  it('looks for nothing when the name has no letters or digits', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await createPayerStore(db).findPayer('r1', ' - '), {
      known: null,
      similar: []
    });
    assert.equal(queries.length, 0);
  });
});
