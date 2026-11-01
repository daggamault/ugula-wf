import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db';
import { buildUpsertDefaultFees, demoFees } from './fees.ts';

describe('fee seeds', () => {
  it('upserts a default price for every ambulance base, mileage and no-transport code', async () => {
    const db = createDummyDb();
    const q = buildUpsertDefaultFees(db, 't-1', demoFees).compile();
    assert.ok(q.sql.includes('on conflict ("tenant_id", "payer_id", "code") do update set'));
    assert.ok(q.sql.includes('"amount_cents" = "excluded"."amount_cents"'));
    assert.deepEqual(Object.keys(demoFees).sort(), [
      'A0425',
      'A0426',
      'A0427',
      'A0428',
      'A0429',
      'A0433',
      'A0434',
      'A0998'
    ]);
    assert.ok(Object.values(demoFees).every((cents) => Number.isInteger(cents) && cents > 0));
    await db.destroy();
  });
});
