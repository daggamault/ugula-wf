import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { createFeeStore } from './queries.ts';

describe('createFeeStore', () => {
  it("prefers the directory payer's price, matched by name ignoring case, over the default", async () => {
    const { db, queries } = createRecordingDb(() => [
      { code: 'A0425', amount_cents: 1550 },
      { code: 'A0427', amount_cents: 50000 }
    ]);
    const store = createFeeStore(db);
    assert.deepEqual(await store.findFees('r1', 'MediCare', ['A0427', 'A0425']), {
      A0425: 1550,
      A0427: 50000
    });
    const [q] = queries;
    assert.ok(q?.sql.startsWith('select distinct on ("code")'));
    assert.ok(
      q?.sql.includes(
        '("payer_id" is null or "payer_id" = (select "id" from "payers" where "tenant_id" = (select "tenant_id" from "workflow_runs" where "id" = $4) and lower(name) = $5))'
      )
    );
    assert.ok(q?.sql.endsWith('order by "code", "payer_id" asc nulls last'));
    assert.deepEqual(q?.parameters, ['r1', 'A0427', 'A0425', 'r1', 'medicare']);
  });

  it('uses only default prices without a payer and skips empty lookups', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createFeeStore(db);
    await store.findFees('r1', null, ['A0427']);
    assert.ok(queries[0]?.sql.includes('and "payer_id" is null'));
    assert.deepEqual(await store.findFees('r1', null, []), {});
    assert.equal(queries.length, 1);
  });
});
