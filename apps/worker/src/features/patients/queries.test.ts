import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
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

const COLUMNS =
  '"id", "first_name", "last_name", "birth_date", "gender", "address_line", "city", "state", "postal_code"';

const AGENCY = '"agency_id" = (select "agency_id" from "workflow_runs" where "id" = $1)';

const candidates = (match: string, n: number) =>
  `select ${COLUMNS} from "patients" where ${AGENCY} and ${match} order by 2 * (birth_date is not distinct from $${n}::date)::int + similarity(last_name_key, $${n + 1}) + (lower(first_name) is not distinct from lower($${n + 2}))::int desc, "created_at" limit $${n + 3}`;

describe('createPatientStore', () => {
  it('finds candidates in the run agency by birth date or a similar last name key, best first', async () => {
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
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          candidates('("birth_date" = $2 or last_name_key % $3)', 4),
          ['r1', '1980-01-02', 'obrien', '1980-01-02', 'obrien', 'Jane', 50]
        ]
      ]
    );
  });

  it('matches on whichever of birth date and last name key it has, and nothing without both', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createPatientStore(db);
    assert.deepEqual(
      await store.findCandidates('r1', {
        birthDate: '1980-01-02',
        lastNameKey: null,
        firstName: null
      }),
      []
    );
    assert.deepEqual(
      await store.findCandidates('r1', {
        birthDate: null,
        lastNameKey: 'obrien',
        firstName: 'Jane'
      }),
      []
    );
    assert.deepEqual(
      await store.findCandidates('r1', { birthDate: null, lastNameKey: null, firstName: 'Jane' }),
      []
    );
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [candidates('"birth_date" = $2', 3), ['r1', '1980-01-02', '1980-01-02', '', null, 50]],
        [candidates('last_name_key % $2', 3), ['r1', 'obrien', null, 'obrien', 'Jane', 50]]
      ]
    );
  });

  it('loads an agency patient by id, ignoring malformed ids and missing patients', async () => {
    const { db, queries } = createRecordingDb((q) => (q.parameters[0] === row.id ? [row] : []));
    const store = createPatientStore(db);
    assert.deepEqual(await store.findPatient('r1', row.id), patient);
    assert.equal(await store.findPatient('r1', '0195f2a4-0000-7000-8000-000000000009'), null);
    assert.equal(await store.findPatient('r1', 'new'), null);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          `select ${COLUMNS} from "patients" where "id" = $1 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $2)`,
          [row.id, 'r1']
        ],
        [
          `select ${COLUMNS} from "patients" where "id" = $1 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $2)`,
          ['0195f2a4-0000-7000-8000-000000000009', 'r1']
        ]
      ]
    );
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

  const LOCK =
    'select pg_advisory_xact_lock(hashtextextended(agency_id::text || $1, 0)) from workflow_runs where id = $2';

  const SAME = `select ${COLUMNS} from "patients" where ${AGENCY} and "last_name_key" = $2 and "birth_date" = $3 order by "created_at"`;

  const INSERT = `insert into "patients" ("agency_id", "first_name", "last_name", "last_name_key", "birth_date", "gender", "address_line", "city", "state", "postal_code", "source_key") values ((select "agency_id" from "workflow_runs" where "id" = $1), $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) on conflict ("agency_id", "source_key") do update set "updated_at" = patients.updated_at returning ${COLUMNS}`;

  const insertParameters = [
    'r1',
    'Jane',
    "O'Brien",
    'obrien',
    '1980-01-02',
    null,
    null,
    null,
    null,
    '90210',
    'r1:s:create:0'
  ];

  it('creates patients once per source key under an identity lock, without looking for a match', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql.startsWith('insert') ? [row] : []));
    const created = await createPatientStore(db).createPatient(
      'r1',
      'r1:s:create:0',
      newJane,
      false
    );
    assert.deepEqual(created, patient);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [LOCK, [':obrien:1980-01-02', 'r1']],
        [INSERT, insertParameters]
      ]
    );
  });

  it('reuses the same person created by a concurrent run when asked', async () => {
    const { db, queries } = createRecordingDb((q) => (q.sql === SAME ? [row] : []));
    assert.deepEqual(
      await createPatientStore(db).createPatient('r1', 'r1:s:create:0', newJane, true),
      patient
    );
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [LOCK, [':obrien:1980-01-02', 'r1']],
        [SAME, ['r1', 'obrien', '1980-01-02']]
      ]
    );
  });

  it('creates a new patient when no one with the name key and birth date is the same person', async () => {
    for (const [reported, existing] of [
      ['Jane', 'Mary'],
      ['J.', 'Jane']
    ]) {
      const { db, queries } = createRecordingDb((q) =>
        q.sql === SAME
          ? [{ ...row, id: 'other', first_name: existing }]
          : q.sql.startsWith('insert')
            ? [row]
            : []
      );
      const created = await createPatientStore(db).createPatient(
        'r1',
        'r1:s:create:0',
        { ...newJane, firstName: reported ?? '' },
        true
      );
      assert.deepEqual(created, patient);
      assert.deepEqual(
        queries.map((q) => q.sql),
        [LOCK, SAME, INSERT]
      );
    }
  });

  const moved = {
    addressLine: '9 Oak Ave',
    city: 'Springfield',
    state: 'IL',
    postalCode: '62702'
  };

  const UPDATE = `update "patients" set "address_line" = $1, "city" = $2, "state" = $3, "postal_code" = $4, "updated_at" = now() where "id" = $5 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $6) returning ${COLUMNS}`;

  it("updates a patient's address in the run agency and returns the patient", async () => {
    const { db, queries } = createRecordingDb(() => [
      { ...row, address_line: '9 Oak Ave', postal_code: '62702' }
    ]);
    assert.deepEqual(await createPatientStore(db).updateAddress('r1', 'k', row.id, moved), {
      ...patient,
      ...moved
    });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [[UPDATE, ['9 Oak Ave', 'Springfield', 'IL', '62702', row.id, 'r1']]]
    );
  });

  it('refuses to update a patient outside the agency, matching nothing for a malformed id', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createPatientStore(db);
    await assert.rejects(
      store.updateAddress('r1', 'k', row.id, moved),
      new RegExp(`Patient ${row.id} does not exist`)
    );
    await assert.rejects(
      store.updateAddress('r1', 'k', 'nope', moved),
      /Patient nope does not exist/
    );
    assert.deepEqual(queries[1]?.parameters, [
      '9 Oak Ave',
      'Springfield',
      'IL',
      '62702',
      null,
      'r1'
    ]);
  });
});
