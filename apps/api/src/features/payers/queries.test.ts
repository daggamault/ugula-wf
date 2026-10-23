import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { deletePayer, listPayers, upsertPayer } from './queries.ts';

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
});
