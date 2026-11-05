import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { deleteFee, findFee, payerExists, saveFee, searchFees } from './queries.ts';

const PAYER = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const PAGE = { page: 1, pageSize: 25, sort: 'payer', dir: 'asc' } as const;

describe('fee queries', () => {
  it('pages fees with their directory payer, defaults first', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchFees(db, 't-1', PAGE);
    const [list] = queries;
    assert.ok(list?.sql.includes('left join "payers" as "p" on "p"."id" = "f"."payer_id"'));
    assert.ok(list?.sql.includes('"p"."name" as "payer"'));
    assert.ok(
      list?.sql.includes('order by (p.name is not null, lower(p.name), f.code) asc nulls last')
    );
    assert.deepEqual(list?.parameters, ['t-1', 25, 0]);
  });

  it('searches codes and payers, where the default schedule is called Default', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await searchFees(db, 't-1', { ...PAGE, sort: 'amount', dir: 'desc', q: 'A04' });
    const [list] = queries;
    assert.ok(list?.sql.includes('lower(f.code) like $2'));
    assert.ok(list?.sql.includes("lower(coalesce(p.name, 'Default')) like $3"));
    assert.ok(list?.sql.includes('order by "f"."amount_cents" desc nulls last'));
    assert.deepEqual(list?.parameters.slice(1, 3), ['%a04%', '%a04%']);
  });

  it('upserts one price per agency, payer and code and returns it with its payer name', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'f1' }]);
    const fee = { payerId: PAYER, code: 'A0427', amountCents: 95000 };
    await saveFee(db, 't-1', fee, { create: true, update: true });
    assert.equal(queries.length, 1);
    const [upsert] = queries;
    assert.ok(upsert?.sql.startsWith('with "saved" as (insert into "fee_schedules"'));
    assert.ok(
      upsert?.sql.includes(
        'on conflict ("agency_id", "payer_id", "code") do update set "amount_cents" = $'
      )
    );
    assert.ok(upsert?.sql.includes('from "saved" as "f" left join "payers" as "p"'));
    assert.deepEqual(upsert?.parameters.slice(0, 4), ['t-1', PAYER, 'A0427', 95000]);
  });

  it('only inserts without update and only updates the same key without create', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const fee = { payerId: null, code: 'A0427', amountCents: 1 };
    assert.equal(await saveFee(db, 't-1', fee, { create: true, update: false }), undefined);
    assert.ok(queries[0]?.sql.includes('on conflict ("agency_id", "payer_id", "code") do nothing'));
    await saveFee(db, 't-1', fee, { create: false, update: true });
    assert.ok(queries[1]?.sql.startsWith('with "saved" as (update "fee_schedules" set'));
    assert.ok(
      queries[1]?.sql.includes(
        '"agency_id" = $2 and payer_id is not distinct from $3 and "code" = $4'
      )
    );
    assert.deepEqual(queries[1]?.parameters, [1, 't-1', null, 'A0427']);
  });

  it('finds, checks payers and deletes only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findFee(db, 't-1', 'f1'), undefined);
    assert.equal(await payerExists(db, 't-1', PAYER), false);
    assert.equal(await deleteFee(db, 't-1', 'f1'), false);
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'f1']);
    assert.deepEqual(queries[1]?.parameters, [PAYER, 't-1']);
    assert.deepEqual(queries[2]?.parameters, ['f1', 't-1']);
  });
});
