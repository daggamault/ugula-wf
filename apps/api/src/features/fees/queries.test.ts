import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { deleteFee, listFees, payerExists, upsertFee } from './queries.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('fee queries', () => {
  it('lists fees with their directory payer, defaults first', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listFees(db, 't-1');
    const [list] = queries;
    assert.ok(list?.sql.includes('left join "payers" as "p" on "p"."id" = "f"."payer_id"'));
    assert.ok(list?.sql.includes('"p"."name" as "payer"'));
    assert.ok(list?.sql.endsWith('order by lower(p.name) asc nulls first, "f"."code"'));
    assert.deepEqual(list?.parameters, ['t-1']);
  });

  it('upserts one price per tenant, payer and code and returns it with its payer name', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'f1' }]);
    await upsertFee(db, 't-1', { payerId: PAYER, code: 'A0427', amountCents: 95000 });
    const [upsert, reread] = queries;
    assert.ok(
      upsert?.sql.includes(
        'on conflict ("tenant_id", "payer_id", "code") do update set "amount_cents" = $'
      )
    );
    assert.deepEqual(upsert?.parameters.slice(0, 4), ['t-1', PAYER, 'A0427', 95000]);
    assert.ok(reread?.sql.includes('"f"."id" = $2'));
  });

  it('checks payers and deletes only within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await payerExists(db, 't-1', PAYER), false);
    assert.equal(await deleteFee(db, 't-1', 'f1'), false);
    assert.deepEqual(queries[0]?.parameters, [PAYER, 't-1']);
    assert.deepEqual(queries[1]?.parameters, ['f1', 't-1']);
  });
});
