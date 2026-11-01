import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { findPatient, listPatients } from './queries.ts';

describe('patient queries', () => {
  it('search by last name key prefix, first name prefix and exact birth date', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listPatients(db, 't-1', {
      lastName: "O'Brien",
      firstName: 'Ja_',
      birthDate: '1980-01-02',
      page: 1,
      pageSize: 25,
      sort: 'balance',
      dir: 'desc'
    });
    const [list] = queries;
    assert.ok(list?.sql.includes('"p"."last_name_key" like $2'));
    assert.ok(list?.sql.includes('lower(p.first_name) like $3'));
    assert.ok(list?.sql.includes('order by "claimed"."balance_cents" desc nulls last'));
    assert.deepEqual(list?.parameters, ['t-1', 'obrien%', 'ja\\_%', '1980-01-02', 25, 0]);
    await db.destroy();
  });

  it('list every patient when no field is given and find one in the tenant', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listPatients(db, 't-1', {
      lastName: ' ',
      page: 1,
      pageSize: 10,
      sort: 'name',
      dir: 'asc'
    });
    await findPatient(db, 't-1', 'p-1');
    assert.ok(!queries[0]?.sql.includes(' like '));
    assert.ok(queries[0]?.sql.includes("filter (where c.status = 'open')"));
    assert.deepEqual(queries[1]?.parameters, ['t-1', 'p-1']);
    await db.destroy();
  });
});
