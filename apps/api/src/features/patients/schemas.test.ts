import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { listPatientsQuery } from './schemas.ts';

describe('patient schemas', () => {
  it('trims names, checks birth dates and sorts by name by default', () => {
    assert.deepEqual(v.parse(listPatientsQuery, { lastName: ' Doe ', birthDate: '1980-01-02' }), {
      lastName: 'Doe',
      birthDate: '1980-01-02',
      page: 1,
      pageSize: 25,
      sort: 'name',
      dir: 'asc'
    });
    assert.equal(v.safeParse(listPatientsQuery, { birthDate: '01/02/1980' }).success, false);
    assert.equal(v.safeParse(listPatientsQuery, { sort: 'balance' }).success, true);
  });
});
