import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { searchPatientsQuery } from './schemas.ts';

const issues = (input: unknown) =>
  v.safeParse(searchPatientsQuery, input).issues?.map((i) => i.message);

const NOTHING = 'Search by last name, first name, birth date or patient number';
const defaults = { page: 1, pageSize: 25, sort: 'name', dir: 'asc' };

describe('searchPatientsQuery', () => {
  it('trims names and sorts by name by default', () => {
    assert.deepEqual(
      v.parse(searchPatientsQuery, {
        lastName: ' Doe ',
        firstName: ' Jane ',
        birthDate: '1980-01-02'
      }),
      { lastName: 'Doe', firstName: 'Jane', birthDate: '1980-01-02', ...defaults }
    );
  });

  it('searches by patient number alone and sorts by it', () => {
    assert.deepEqual(v.parse(searchPatientsQuery, { number: ' 20261105-0003 ', sort: 'number' }), {
      ...defaults,
      number: '20261105-0003',
      sort: 'number'
    });
  });

  it('reads a page, size, sort and direction', () => {
    assert.deepEqual(
      v.parse(searchPatientsQuery, {
        firstName: 'Jane',
        page: '3',
        pageSize: '50',
        sort: 'claims',
        dir: 'desc'
      }),
      { firstName: 'Jane', page: 3, pageSize: 50, sort: 'claims', dir: 'desc' }
    );
  });

  it('needs something to search for', () => {
    assert.deepEqual(issues({}), [NOTHING]);
    assert.deepEqual(issues({ sort: 'balance' }), [NOTHING]);
    assert.deepEqual(issues({ lastName: ' ', number: ' ' }), [NOTHING]);
  });

  it('refuses birth dates that are not ISO dates', () => {
    assert.deepEqual(issues({ birthDate: '01/02/1980' }), ['Use a date like 1980-01-31']);
  });

  it('refuses long names and numbers, unknown sorts and page sizes', () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ lastName: 'x'.repeat(61) }, 'Invalid length: Expected <=60 but received 61'],
      [{ firstName: 'x'.repeat(61) }, 'Invalid length: Expected <=60 but received 61'],
      [{ number: '1'.repeat(41) }, 'Invalid length: Expected <=40 but received 41'],
      [
        { sort: 'payer' },
        'Invalid type: Expected ("name" | "number" | "born" | "lastService" | "balance" | "city" | "claims") but received "payer"'
      ],
      [{ pageSize: '30' }, 'Invalid type: Expected (10 | 25 | 50 | 100) but received 30']
    ];
    for (const [patch, message] of cases) {
      assert.deepEqual(issues({ lastName: 'doe', ...patch }), [message], message);
    }
  });
});
