import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { deleteFee, listFees, upsertFee } from './queries.ts';

describe('fee queries', () => {
  it('lists, upserts and deletes only within the tenant', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('delete') ? [] : [{ id: 'f1' }]
    );
    await listFees(db, 't-1');
    await upsertFee(db, 't-1', { payer: null, code: 'A0427', amountCents: 95000 });
    assert.equal(await deleteFee(db, 't-1', 'f1'), false);
    const [list, upsert, remove] = queries;
    assert.ok(list?.sql.endsWith('order by "payer" asc nulls first, "code"'));
    assert.ok(
      upsert?.sql.includes(
        'on conflict (tenant_id, lower(coalesce(payer, \'\')), code) do update set "amount_cents" = $'
      )
    );
    assert.deepEqual(remove?.parameters, ['f1', 't-1']);
    await db.destroy();
  });
});
