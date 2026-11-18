import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeStore } from './queries.ts';

const PAYER = '0195f2a4-0000-7000-8000-00000000000b';

const FEE =
  'select "amount_cents" from "fee_schedules" where "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1) and "code" = $2';

describe('createFeeStore', () => {
  it("prefers the payer's own fee for the code, then the standard fee, in one query", async () => {
    const { db, queries } = createRecordingDb(() => [{ amount_cents: 50000 }]);
    assert.equal(await createFeeStore(db).findFee('r1', PAYER, 'A0427'), 50000);
    assert.equal(
      queries[0]?.sql,
      `${FEE} and ("payer_id" is null or "payer_id" = $3) order by payer_id is null limit $4`
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', 'A0427', PAYER, 1]);
  });

  it('reads the standard fee without a payer and nothing when the code has no fee', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await createFeeStore(db).findFee('r1', null, 'A0999'), null);
    assert.equal(
      queries[0]?.sql,
      `${FEE} and "payer_id" is null order by payer_id is null limit $3`
    );
  });

  it('refuses a payer id that is not an id before querying', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await assert.rejects(
      createFeeStore(db).findFee('r1', 'p-1', 'A0427'),
      /Payer p-1 does not exist/
    );
    assert.equal(queries.length, 0);
  });
});
