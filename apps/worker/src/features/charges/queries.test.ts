import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createFeeStore } from './queries.ts';

const PAYER = '0195f2a4-0000-7000-8000-00000000000b';

const SCHEDULES =
  'select "code", "payer_id", "amount_cents" from "fee_schedules" where "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1) and "code" in ($2, $3)';

const _upsert = (payerFilter: string) =>
  `insert into "fee_schedules" ("agency_id", "payer_id", "code", "amount_cents") select "r"."agency_id", "p"."id", $1::text as "code", $2::int as "amount_cents" from "workflow_runs" as "r" left join "payers" as "p" on "p"."agency_id" = "r"."agency_id" and "p"."id" = $3 where "r"."id" = $4 and ${payerFilter} on conflict on constraint "fee_schedules_agency_payer_code_unique" do update set "amount_cents" = "excluded"."amount_cents", "updated_at" = now()`;

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
    assert.equal(
      queries[0]?.sql,
      `${SCHEDULES} and ("payer_id" is null or "payer_id" = $4) order by "code"`
    );
    assert.deepEqual(queries[0]?.parameters, ['r1', 'A0427', 'A0425', PAYER]);
  });

  it('reads only default prices without a payer or for a payer id that is not a UUID', async () => {
    const { db, queries } = createRecordingDb(() => [
      { code: 'A0427', payer_id: null, amount_cents: 60000 }
    ]);
    const store = createFeeStore(db);
    for (const payer of [null, 'not-a-uuid']) {
      assert.deepEqual(await store.findSchedules('r1', payer, ['A0427', 'A0425']), {
        payer: {},
        default: { A0427: 60000 }
      });
    }
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [`${SCHEDULES} and "payer_id" is null order by "code"`, ['r1', 'A0427', 'A0425']],
        [`${SCHEDULES} and "payer_id" is null order by "code"`, ['r1', 'A0427', 'A0425']]
      ]
    );
  });

  it('answers an empty lookup without querying', async () => {
    const { db, queries } = createRecordingDb(() => [{}]);
    assert.deepEqual(await createFeeStore(db).findSchedules('r1', PAYER, []), {
      payer: {},
      default: {}
    });
    assert.equal(queries.length, 0);
  });
});
