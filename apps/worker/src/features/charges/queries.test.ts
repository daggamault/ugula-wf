import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeStore } from './queries.ts';

const PAYER = '0195f2a4-0000-7000-8000-00000000000b';

describe('createFeeStore', () => {
  it("prefers the directory payer's price over the default", async () => {
    const { db, queries } = createRecordingDb(() => [
      { code: 'A0425', amount_cents: 1550 },
      { code: 'A0427', amount_cents: 50000 }
    ]);
    const store = createFeeStore(db);
    assert.deepEqual(await store.findFees('r1', PAYER, ['A0427', 'A0425']), {
      A0425: 1550,
      A0427: 50000
    });
    const [q] = queries;
    assert.ok(q?.sql.startsWith('select distinct on ("code")'));
    assert.ok(q?.sql.includes('and ("payer_id" is null or "payer_id" = $4)'));
    assert.ok(q?.sql.endsWith('order by "code", "payer_id" asc nulls last'));
    assert.deepEqual(q?.parameters, ['r1', 'A0427', 'A0425', PAYER]);
  });

  it('uses only default prices without a valid payer and skips empty lookups', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createFeeStore(db);
    await store.findFees('r1', null, ['A0427']);
    assert.ok(queries[0]?.sql.includes('and "payer_id" is null'));
    await store.findFees('r1', 'not-a-uuid', ['A0427']);
    assert.ok(
      queries[1]?.sql.endsWith('and "payer_id" is null order by "code", "payer_id" asc nulls last')
    );
    assert.ok(!queries[1]?.parameters.includes('not-a-uuid'));
    assert.deepEqual(await store.findFees('r1', null, []), {});
    assert.equal(queries.length, 2);
  });

  it('saves a default or directory payer price with one upsert', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert') && !q.parameters.includes('nope') ? [{}] : []
    );
    const store = createFeeStore(db);
    await store.saveFee('r1', null, 'A0427', 52_000);
    const [insert] = queries;
    assert.ok(
      insert?.sql.startsWith(
        'insert into "fee_schedules" ("tenant_id", "payer_id", "code", "amount_cents") select'
      )
    );
    assert.ok(
      insert?.sql.endsWith(
        'on conflict on constraint "fee_schedules_tenant_payer_code_unique" do update set "amount_cents" = "excluded"."amount_cents", "updated_at" = now()'
      )
    );
    assert.deepEqual(insert?.parameters, ['A0427', 52_000, null, 'r1']);
    await store.saveFee('r1', PAYER, 'A0427', 52_000);
    assert.ok(queries[1]?.sql.includes('"p"."id" is not null'));
    await assert.rejects(store.saveFee('r1', 'nope', 'A0427', 1), /not in the directory/);
    assert.equal(queries.length, 2);
  });
});
