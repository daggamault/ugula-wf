import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { deleteFee, findFee, payerExists, searchFees, upsertFee } from './queries.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const PAGE = { page: 1, pageSize: 25, sort: 'payer', dir: 'asc' } as const;

const ROW = {
  id: 'f1',
  payer_id: PAYER,
  payer: 'Medicare',
  code: 'A0427',
  amount_cents: 95000,
  updated_at: 'now'
};

describe('fee queries', () => {
  it('pages agency fees with their directory payer, defaults first', async () => {
    const { db, queries } = createRecordingDb(() => [{ ...ROW, total: '1' }]);
    assert.deepEqual(await searchFees(db, 't-1', PAGE), {
      items: [ROW],
      total: 1,
      page: 1,
      pageSize: 25
    });
    assert.equal(
      queries[0]?.sql,
      'select "f"."id", "f"."payer_id", "p"."name" as "payer", "f"."code", "f"."amount_cents", "f"."updated_at", count(*) over () as "total" from "fee_schedules" as "f" left join "payers" as "p" on "p"."id" = "f"."payer_id" where "f"."agency_id" = $1 order by (p.name is not null, lower(p.name), f.code) asc nulls last, "f"."id" asc limit $2 offset $3'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
  });

  it('searches codes and payers, where the default schedule is called Default', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchFees(db, 't-1', { ...PAGE, sort: 'amount', dir: 'desc', q: ' A0_4 ' });
    assert.equal(
      queries[0]?.sql,
      `select "f"."id", "f"."payer_id", "p"."name" as "payer", "f"."code", "f"."amount_cents", "f"."updated_at", count(*) over () as "total" from "fee_schedules" as "f" left join "payers" as "p" on "p"."id" = "f"."payer_id" where "f"."agency_id" = $1 and (lower(f.code) like $2 or lower(coalesce(p.name, 'Default')) like $3) order by "f"."amount_cents" desc nulls last, "f"."id" desc limit $4 offset $5`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '%a0\\_4%', '%a0\\_4%', 25, 0]);
  });

  it('sorts by code or by when the fee last changed', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchFees(db, 't-1', { ...PAGE, sort: 'code' });
    await searchFees(db, 't-1', { ...PAGE, sort: 'updated' });
    assert.ok(
      queries[0]?.sql.endsWith(
        'order by "f"."code" asc nulls last, "f"."id" asc limit $2 offset $3'
      )
    );
    assert.ok(
      queries[1]?.sql.endsWith(
        'order by "f"."updated_at" asc nulls last, "f"."id" asc limit $2 offset $3'
      )
    );
  });

  it('upserts one price per agency, payer and code and returns it with its payer name', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    const fee = { payerId: PAYER, code: 'A0427', amountCents: 95000 };
    assert.deepEqual(await upsertFee(db, 't-1', fee, { create: true, update: true }), ROW);
    assert.equal(queries.length, 1);
    assert.equal(
      queries[0]?.sql,
      'with "saved" as (insert into "fee_schedules" ("agency_id", "payer_id", "code", "amount_cents") values ($1, $2, $3, $4) on conflict ("agency_id", "payer_id", "code") do update set "amount_cents" = $5, "updated_at" = now() returning "id", "payer_id", "code", "amount_cents", "updated_at") select "f"."id", "f"."payer_id", "p"."name" as "payer", "f"."code", "f"."amount_cents", "f"."updated_at" from "saved" as "f" left join "payers" as "p" on "p"."id" = "f"."payer_id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', PAYER, 'A0427', 95000, 95000]);
  });

  it('only inserts a new price without update', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const fee = { payerId: null, code: 'A0427', amountCents: 1 };
    assert.equal(await upsertFee(db, 't-1', fee, { create: true, update: false }), undefined);
    assert.equal(
      queries[0]?.sql,
      'with "saved" as (insert into "fee_schedules" ("agency_id", "payer_id", "code", "amount_cents") values ($1, $2, $3, $4) on conflict ("agency_id", "payer_id", "code") do nothing returning "id", "payer_id", "code", "amount_cents", "updated_at") select "f"."id", "f"."payer_id", "p"."name" as "payer", "f"."code", "f"."amount_cents", "f"."updated_at" from "saved" as "f" left join "payers" as "p" on "p"."id" = "f"."payer_id"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', null, 'A0427', 1]);
  });

  it('only updates the same agency, payer and code without create', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const fee = { payerId: null, code: 'A0427', amountCents: 1 };
    assert.equal(await upsertFee(db, 't-1', fee, { create: false, update: true }), undefined);
    assert.equal(
      queries[0]?.sql,
      'with "saved" as (update "fee_schedules" set "amount_cents" = $1, "updated_at" = now() where "agency_id" = $2 and payer_id is not distinct from $3 and "code" = $4 returning "id", "payer_id", "code", "amount_cents", "updated_at") select "f"."id", "f"."payer_id", "p"."name" as "payer", "f"."code", "f"."amount_cents", "f"."updated_at" from "saved" as "f" left join "payers" as "p" on "p"."id" = "f"."payer_id"'
    );
    assert.deepEqual(queries[0]?.parameters, [1, 't-1', null, 'A0427']);
  });

  it('finds a fee within the agency', async () => {
    const { db, queries } = createRecordingDb(() => [ROW]);
    assert.deepEqual(await findFee(db, 't-1', 'f1'), ROW);
    assert.equal(
      queries[0]?.sql,
      'select "f"."id", "f"."payer_id", "p"."name" as "payer", "f"."code", "f"."amount_cents", "f"."updated_at" from "fee_schedules" as "f" left join "payers" as "p" on "p"."id" = "f"."payer_id" where "f"."agency_id" = $1 and "f"."id" = $2'
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'f1']);
  });

  it('checks a payer is in the agency directory', async () => {
    const found = createRecordingDb(() => [{ id: PAYER }]);
    assert.equal(await payerExists(found.db, 't-1', PAYER), true);
    assert.equal(
      found.queries[0]?.sql,
      'select "id" from "payers" where "id" = $1 and "agency_id" = $2'
    );
    assert.deepEqual(found.queries[0]?.parameters, [PAYER, 't-1']);
    assert.equal(await payerExists(createRecordingDb(() => []).db, 't-1', PAYER), false);
  });

  it('deletes a fee only within the agency and says whether it existed', async () => {
    const found = createRecordingDb(() => [{ id: 'f1' }]);
    assert.equal(await deleteFee(found.db, 't-1', 'f1'), true);
    assert.equal(
      found.queries[0]?.sql,
      'delete from "fee_schedules" where "id" = $1 and "agency_id" = $2 returning "id"'
    );
    assert.deepEqual(found.queries[0]?.parameters, ['f1', 't-1']);
    assert.equal(await deleteFee(createRecordingDb(() => []).db, 't-1', 'f1'), false);
  });
});
