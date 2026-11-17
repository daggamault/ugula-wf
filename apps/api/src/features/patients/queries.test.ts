import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findPatient, searchPatients } from './queries.ts';

const COLUMNS =
  'select "p"."id", "p"."number", "p"."first_name", "p"."last_name", p.birth_date::text as "birth_date", "p"."gender", "p"."address_line", "p"."city", "p"."state", "p"."postal_code", "claimed"."claim_count", "claimed"."last_service_date"';
const FROM = `from "patients" as "p" left join lateral (select count(*)::int as "claim_count", max(c.service_date)::text as "last_service_date" from "claims" as "c" where "c"."patient_id" = "p"."id") as "claimed" on true where "p"."agency_id" = $1`;
const page = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' } as const;
const orderOf = (sql = '') => sql.slice(sql.lastIndexOf(' order by '));

describe('searchPatients', () => {
  it('lists every agency patient by name with claim counts', async () => {
    const { db, queries } = createRecordingDb();
    await searchPatients(db, 't-1', page);
    assert.equal(
      queries[0]?.sql,
      `${COLUMNS}, count(*) over () as "total" ${FROM} order by lower(p.last_name || ' ' || p.first_name) asc nulls last, "p"."id" asc limit $2 offset $3`
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
    await db.destroy();
  });

  it('ignores blank names', async () => {
    const { db, queries } = createRecordingDb();
    await searchPatients(db, 't-1', { ...page, lastName: ' ', firstName: ' ' });
    assert.ok(queries[0]?.sql.includes(`${FROM} order by`));
    assert.deepEqual(queries[0]?.parameters, ['t-1', 25, 0]);
    await db.destroy();
  });

  it('searches by last name key prefix, escaped first name prefix and exact birth date', async () => {
    const { db, queries } = createRecordingDb();
    await searchPatients(db, 't-1', {
      ...page,
      lastName: "O'Brien",
      firstName: ' Ja_ ',
      birthDate: '1980-01-02',
      sort: 'claims',
      dir: 'desc'
    });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${FROM} and "p"."last_name_key" like $2 and lower(p.first_name) like $3 and "p"."birth_date" = $4 order by "claimed"."claim_count" desc nulls last, "p"."id" desc limit $5 offset $6`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'obrien%', 'ja\\_%', '1980-01-02', 25, 0]);
    await db.destroy();
  });

  it('finds a patient by the daily number however it is typed', async () => {
    const { db, queries } = createRecordingDb();
    await searchPatients(db, 't-1', { ...page, number: '#202611050003', sort: 'number' });
    assert.ok(
      queries[0]?.sql.endsWith(
        `${FROM} and "p"."number" = $2 order by "p"."number" asc nulls last, "p"."id" asc limit $3 offset $4`
      )
    );
    assert.deepEqual(queries[0]?.parameters, ['t-1', '20261105-0003', 25, 0]);
    await db.destroy();
  });

  it('matches no patient for a number that is not a daily number', async () => {
    const { db, queries } = createRecordingDb();
    await searchPatients(db, 't-1', { ...page, number: 'nope' });
    assert.ok(queries[0]?.sql.includes(`${FROM} and "p"."number" = $2 order by`));
    assert.deepEqual(queries[0]?.parameters, ['t-1', '', 25, 0]);
    await db.destroy();
  });

  it('sorts by birth date, last service, city or claim count', async () => {
    const { db, queries } = createRecordingDb();
    for (const sort of ['born', 'lastService', 'city', 'claims'] as const) {
      await searchPatients(db, 't-1', { ...page, sort, dir: 'desc' });
    }
    assert.deepEqual(
      queries.map((q) => orderOf(q.sql)),
      [
        '"p"."birth_date"',
        '"claimed"."last_service_date"',
        "lower(p.city || ' ' || coalesce(p.state, ''))",
        '"claimed"."claim_count"'
      ].map((by) => ` order by ${by} desc nulls last, "p"."id" desc limit $2 offset $3`)
    );
    await db.destroy();
  });

  it('maps a page of patients without the window total', async () => {
    const row = { id: 'p-1', last_name: 'Doe', claim_count: 2, balance_cents: 1500 };
    const { db } = createRecordingDb(() => [{ ...row, total: '7' }]);
    assert.deepEqual(await searchPatients(db, 't-1', page), {
      items: [row],
      total: 7,
      page: 1,
      pageSize: 25
    });
    await db.destroy();
  });

  it('counts the total on a page past the end so pagers stay right', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select count(*)') ? [{ total: '3' }] : []
    );
    const result = await searchPatients(db, 't-1', {
      birthDate: '1980-01-02',
      page: 4,
      pageSize: 10,
      sort: 'born',
      dir: 'asc'
    });
    assert.deepEqual(result, { items: [], total: 3, page: 4, pageSize: 10 });
    assert.deepEqual(queries[0]?.parameters, ['t-1', '1980-01-02', 10, 30]);
    assert.equal(queries[1]?.sql, `select count(*) as "total" ${FROM} and "p"."birth_date" = $2`);
    assert.deepEqual(queries[1]?.parameters, ['t-1', '1980-01-02']);
    await db.destroy();
  });
});

describe('findPatient', () => {
  it('finds one patient within the agency', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await findPatient(db, 't-1', 'p-1'), undefined);
    assert.equal(queries[0]?.sql, `${COLUMNS} ${FROM} and "p"."id" = $2`);
    assert.deepEqual(queries[0]?.parameters, ['t-1', 'p-1']);
    await db.destroy();
  });
});
