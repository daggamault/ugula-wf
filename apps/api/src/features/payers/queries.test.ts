import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { deletePayer, linkCoverages, listPayers, upsertPayer } from './queries.ts';

describe('payer queries', () => {
  it('lists, upserts by name ignoring case, and deletes within the tenant', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('delete') ? [] : [{ id: 'p1' }]
    );
    await listPayers(db, 't-1');
    await upsertPayer(db, 't-1', { name: 'Medicare', payerId: '00952', claimFiling: 'MB' });
    assert.equal(await deletePayer(db, 't-1', 'p1'), false);
    const [list, upsert, remove] = queries;
    assert.ok(list?.sql.endsWith('order by lower(name)'));
    assert.ok(upsert?.sql.includes('on conflict (tenant_id, lower(name)) do update set'));
    assert.deepEqual(remove?.parameters, ['p1', 't-1']);
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
