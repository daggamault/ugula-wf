import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeStore } from './queries.ts';

const PAYER = '0195f2a4-0000-7000-8000-00000000000b';

describe('createFeeStore', () => {
  it("reads the directory payer's prices and the default prices as separate schedules", async () => {
    const { db, queries } = createRecordingDb(() => [
      { code: 'A0425', payer_id: null, amount_cents: 1550 },
      { code: 'A0427', payer_id: null, amount_cents: 60000 },
      { code: 'A0427', payer_id: PAYER, amount_cents: 50000 }
    ]);
    const store = createFeeStore(db);
    assert.deepEqual(await store.findSchedules('r1', PAYER, ['A0427', 'A0425']), {
      payer: { A0427: 50000 },
      default: { A0425: 1550, A0427: 60000 }
    });
    const [q] = queries;
    assert.ok(q?.sql.startsWith('select "code", "payer_id", "amount_cents" from "fee_schedules"'));
    assert.ok(q?.sql.includes('and ("payer_id" is null or "payer_id" = $4)'));
    assert.ok(q?.sql.endsWith('order by "code"'));
    assert.deepEqual(q?.parameters, ['r1', 'A0427', 'A0425', PAYER]);
  });

  it('uses only default prices without a valid payer and skips empty lookups', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createFeeStore(db);
    await store.findSchedules('r1', null, ['A0427']);
    assert.ok(queries[0]?.sql.includes('and "payer_id" is null'));
    await store.findSchedules('r1', 'not-a-uuid', ['A0427']);
    assert.ok(queries[1]?.sql.endsWith('and "payer_id" is null order by "code"'));
    assert.ok(!queries[1]?.parameters.includes('not-a-uuid'));
    assert.deepEqual(await store.findSchedules('r1', null, []), { payer: {}, default: {} });
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
        'insert into "fee_schedules" ("agency_id", "payer_id", "code", "amount_cents") select'
      )
    );
    assert.ok(
      insert?.sql.endsWith(
        'on conflict on constraint "fee_schedules_agency_payer_code_unique" do update set "amount_cents" = "excluded"."amount_cents", "updated_at" = now()'
      )
    );
    assert.deepEqual(insert?.parameters, ['A0427', 52_000, null, 'r1']);
    await store.saveFee('r1', PAYER, 'A0427', 52_000);
    assert.ok(queries[1]?.sql.includes('"p"."id" is not null'));
    await assert.rejects(store.saveFee('r1', 'nope', 'A0427', 1), /not in the directory/);
    assert.equal(queries.length, 2);
  });
});
