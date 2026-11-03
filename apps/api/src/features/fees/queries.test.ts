import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { deleteFee, findFee, payerExists, searchFees, upsertFee } from './queries.ts';

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

  it('upserts one price per tenant, payer and code and returns it with its payer name', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'f1' }]);
    await upsertFee(db, 't-1', { payerId: PAYER, code: 'A0427', amountCents: 95000 });
    assert.equal(queries.length, 1);
    const [upsert] = queries;
    assert.ok(upsert?.sql.startsWith('with "saved" as (insert into "fee_schedules"'));
    assert.ok(
      upsert?.sql.includes(
        'on conflict ("tenant_id", "payer_id", "code") do update set "amount_cents" = $'
      )
    );
    assert.ok(upsert?.sql.includes('from "saved" as "f" left join "payers" as "p"'));
    assert.deepEqual(upsert?.parameters.slice(0, 4), ['t-1', PAYER, 'A0427', 95000]);
  });

  it('finds, checks payers and deletes only within the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findFee(db, 't-1', 'f1'), undefined);
    assert.equal(await payerExists(db, 't-1', PAYER), false);
    assert.equal(await deleteFee(db, 't-1', 'f1'), false);
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'f1']);
    assert.deepEqual(queries[1]?.parameters, [PAYER, 't-1']);
    assert.deepEqual(queries[2]?.parameters, ['f1', 't-1']);
  });
});
