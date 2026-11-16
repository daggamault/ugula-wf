import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { listClaimEventsQuery, searchClaimsQuery, startTaskSchema } from './schemas.ts';

describe('claim schemas', () => {
  it('defaults list filters to open claims', () => {
    assert.deepEqual(v.parse(searchClaimsQuery, {}), {
      status: 'open',
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc'
    });
    assert.equal(v.safeParse(searchClaimsQuery, { sort: 'balance', dir: 'asc' }).success, true);
    assert.equal(v.safeParse(searchClaimsQuery, { sort: 'payer' }).success, false);
    assert.deepEqual(
      v.parse(searchClaimsQuery, { status: 'all', lastName: ' smith ' }).lastName,
      'smith'
    );
    assert.equal(v.safeParse(searchClaimsQuery, { status: 'needs_review' }).success, false);
    assert.equal(v.safeParse(searchClaimsQuery, { status: 'pending' }).success, false);
    assert.equal(v.safeParse(searchClaimsQuery, { birthDate: '01/02/1980' }).success, false);
    assert.equal(v.parse(searchClaimsQuery, { number: ' 42 ' }).number, '42');
    assert.equal(v.safeParse(searchClaimsQuery, { patientId: 'x' }).success, false);
    assert.equal(v.parse(searchClaimsQuery, { sort: 'waiting' }).sort, 'waiting');
    assert.equal(v.parse(searchClaimsQuery, { sort: 'encounter' }).sort, 'encounter');
  });

  it('starts only the claim task workflows a biller may start', () => {
    assert.deepEqual(v.parse(startTaskSchema, { workflow: 'billing.post-payment' }), {
      workflow: 'billing.post-payment'
    });
    assert.equal(v.safeParse(startTaskSchema, { workflow: 'billing.cycle-claim' }).success, false);
    assert.equal(v.safeParse(startTaskSchema, {}).success, false);
  });
});
describe('claim paging schemas', () => {
  it('pages claims and history only by the sizes and sorts the lists offer', () => {
    assert.deepEqual(v.parse(listClaimEventsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'when',
      dir: 'desc'
    });
    assert.deepEqual(
      v.parse(listClaimEventsQuery, { page: '3', pageSize: '100', sort: 'payer', dir: 'asc' }),
      { page: 3, pageSize: 100, sort: 'payer', dir: 'asc' }
    );
    const fails = (schema: typeof listClaimEventsQuery | typeof searchClaimsQuery, q: object) =>
      !v.safeParse(schema, q).success;
    assert.ok(fails(listClaimEventsQuery, { sort: 'created' }));
    assert.ok(fails(listClaimEventsQuery, { dir: 'up' }));
    assert.ok(fails(searchClaimsQuery, { page: '0' }));
    assert.ok(fails(searchClaimsQuery, { page: '1.5' }));
    assert.ok(fails(searchClaimsQuery, { pageSize: '7' }));
    assert.ok(fails(searchClaimsQuery, { number: 'x'.repeat(41) }));
  });
});
