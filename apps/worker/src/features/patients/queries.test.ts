import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { createPatientStore } from './queries.ts';

const row = {
  id: '0195f2a4-0000-7000-8000-000000000001',
  first_name: 'Jane',
  last_name: "O'Brien",
  birth_date: '1980-01-02',
  gender: '9919001',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '90210'
};

const patient = {
  id: row.id,
  firstName: 'Jane',
  lastName: "O'Brien",
  birthDate: '1980-01-02',
  gender: 'F' as const,
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '90210'
};

describe('createPatientStore', () => {
  it('finds candidates in the run tenant by birth date or last name key', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    const store = createPatientStore(db);
    assert.deepEqual(
      await store.findCandidates('r1', {
        birthDate: '1980-01-02',
        lastNameKey: 'obrien',
        firstName: 'Jane'
      }),
      [patient]
    );
    assert.match(
      queries[0]?.sql ?? '',
      /"tenant_id" = \(select "tenant_id" from "workflow_runs" where "id" = \$1\) and \("birth_date" = \$2 or "last_name_key" = \$3\)/
    );
    assert.deepEqual(queries[0]?.parameters, [
      'r1',
      '1980-01-02',
      'obrien',
      '1980-01-02',
      'obrien',
      'Jane',
      50
    ]);
    assert.ok(
      queries[0]?.sql.includes(
        '::int + (lower(first_name) is not distinct from lower($6))::int desc, "created_at" limit'
      )
    );
    assert.deepEqual(
      await store.findCandidates('r1', { birthDate: null, lastNameKey: null, firstName: null }),
      []
    );
    assert.equal(queries.length, 1);
  });

  it('loads tenant patients by id and ignores malformed ids', async () => {
    const { db, queries } = createRecordingDb(() => [row]);
    const store = createPatientStore(db);
    assert.deepEqual(await store.findPatient('r1', row.id), patient);
    assert.equal(await store.findPatient('r1', 'new'), null);
    assert.equal(queries.length, 1);
  });

  const newJane = {
    firstName: 'Jane',
    lastName: "O'Brien",
    birthDate: '1980-01-02',
    gender: null,
    addressLine: null,
    city: null,
    state: null,
    postalCode: '90210'
  };

  const sqlOf = (queries: { sql: string }[]) =>
    queries.map((q) => q.sql).filter((q) => !/^(begin|commit)/.test(q));

  it('creates patients once per source key under an identity lock', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql.startsWith('insert') ? [row] : []));
    const created = await createPatientStore(db).createPatient(
      'r1',
      'r1:s:create:0',
      newJane,
      false
    );
    assert.deepEqual(created, patient);
    const [lock, insert] = sqlOf(queries);
    assert.equal(
      lock,
      'select pg_advisory_xact_lock(hashtextextended(tenant_id::text || $1, 0)) from workflow_runs where id = $2'
    );
    assert.deepEqual(queries.find((q) => q.sql === lock)?.parameters, [':obrien:1980-01-02', 'r1']);
    assert.ok(
      insert?.includes(
        'on conflict ("tenant_id", "source_key") do update set "updated_at" = patients.updated_at returning'
      )
    );
  });

  it('reuses the same person created by a concurrent run when asked', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "id"') ? [row] : []
    );
    const store = createPatientStore(db);
    assert.deepEqual(
      await store.createPatient('r1', 'k', { ...newJane, firstName: 'J.' }, true),
      patient
    );
    assert.equal(sqlOf(queries).filter((q) => q.startsWith('insert')).length, 0);
    const other = createRecordingDb((q) =>
      q.sql.startsWith('select "id"')
        ? [{ ...row, first_name: 'Mary' }]
        : q.sql.startsWith('insert')
          ? [row]
          : []
    );
    await createPatientStore(other.db).createPatient('r1', 'k', newJane, true);
    assert.equal(sqlOf(other.queries).filter((q) => q.startsWith('insert')).length, 1);
  });
});
