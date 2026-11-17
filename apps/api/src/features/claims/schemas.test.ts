import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { searchClaimsQuery } from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('searchClaimsQuery', () => {
  it('defaults to the first page of every claim, newest first', () => {
    assert.deepEqual(v.parse(searchClaimsQuery, {}), {
      status: [],
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc'
    });
  });

  it('trims the name and number filters and keeps the other filters', () => {
    assert.deepEqual(
      v.parse(searchClaimsQuery, {
        status: 'needs_review',
        firstName: ' ann ',
        lastName: ' smith ',
        birthDate: '1980-01-02',
        number: ' 42 ',
        patientId: ID,
        page: '2',
        pageSize: '50',
        sort: 'total',
        dir: 'asc'
      }),
      {
        status: ['needs_review'],
        firstName: 'ann',
        lastName: 'smith',
        birthDate: '1980-01-02',
        number: '42',
        patientId: ID,
        page: 2,
        pageSize: 50,
        sort: 'total',
        dir: 'asc'
      }
    );
  });

  it('sorts by each column the claim list offers', () => {
    for (const sort of [
      'created',
      'number',
      'service',
      'patient',
      'pcr',
      'encounter',
      'total',
      'status'
    ]) {
      assert.equal(v.parse(searchClaimsQuery, { sort }).sort, sort);
    }
    assert.deepEqual(issues(searchClaimsQuery, { sort: 'payer' }), [
      'Invalid type: Expected ("created" | "number" | "service" | "patient" | "pcr" | ' +
        '"encounter" | "total" | "status") but received "payer"'
    ]);
  });

  it('filters only by known statuses', () => {
    assert.equal(v.safeParse(searchClaimsQuery, { status: 'needs_review,open' }).success, false);
  });

  it('rejects a malformed birth date, patient id or overlong filter', () => {
    assert.deepEqual(issues(searchClaimsQuery, { birthDate: '01/02/1980' }), [
      'Use a date like 1980-01-02'
    ]);
    assert.deepEqual(issues(searchClaimsQuery, { patientId: 'x' }), ['Invalid UUID: Received "x"']);
    assert.deepEqual(issues(searchClaimsQuery, { number: 'x'.repeat(41) }), [
      'Invalid length: Expected <=40 but received 41'
    ]);
    assert.deepEqual(issues(searchClaimsQuery, { lastName: 'x'.repeat(61) }), [
      'Invalid length: Expected <=60 but received 61'
    ]);
  });

  it('pages only by whole pages and the offered page sizes', () => {
    assert.deepEqual(issues(searchClaimsQuery, { page: '0' }), [
      'Invalid value: Expected >=1 but received 0'
    ]);
    assert.deepEqual(issues(searchClaimsQuery, { page: '1.5' }), ['Invalid integer: Received 1.5']);
    assert.deepEqual(issues(searchClaimsQuery, { pageSize: '7' }), [
      'Invalid type: Expected (10 | 25 | 50 | 100) but received 7'
    ]);
  });
});
