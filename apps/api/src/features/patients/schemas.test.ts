import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { listPatientsQuery } from './schemas.ts';

describe('patient schemas', () => {
  it('trims names, checks birth dates, needs something to search for and sorts by name', () => {
    assert.deepEqual(v.parse(listPatientsQuery, { lastName: ' Doe ', birthDate: '1980-01-02' }), {
      lastName: 'Doe',
      birthDate: '1980-01-02',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    assert.equal(v.safeParse(listPatientsQuery, { birthDate: '01/02/1980' }).success, false);
    assert.equal(v.safeParse(listPatientsQuery, { lastName: 'k', sort: 'balance' }).success, true);
    assert.equal(v.safeParse(listPatientsQuery, { sort: 'balance' }).success, false);
  });

  it('searches by patient number alone and sorts by it', () => {
    assert.deepEqual(v.parse(listPatientsQuery, { number: ' 20261105-0003 ', sort: 'number' }), {
      number: '20261105-0003',
      page: 1,
      pageSize: 25,
      sort: 'number',
      dir: 'asc'
    });
    const empty = v.safeParse(listPatientsQuery, { number: ' ' });
    assert.equal(empty.success, false);
    assert.equal(
      empty.issues?.[0]?.message,
      'Search by last name, first name, birth date or patient number'
    );
    assert.equal(v.safeParse(listPatientsQuery, { number: '1'.repeat(41) }).success, false);
  });
});

describe('patient search limits', () => {
  it('rejects overly long names and unknown sorts and page sizes', () => {
    const fails = (q: object) => !v.safeParse(listPatientsQuery, { lastName: 'doe', ...q }).success;
    assert.ok(fails({ lastName: 'x'.repeat(61) }));
    assert.ok(fails({ firstName: 'x'.repeat(61) }));
    assert.ok(fails({ sort: 'payer' }));
    assert.ok(fails({ pageSize: '30' }));
    assert.ok(!fails({ firstName: 'Jane', sort: 'claims', dir: 'desc', pageSize: '50' }));
  });
});
