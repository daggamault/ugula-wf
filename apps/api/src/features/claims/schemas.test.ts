import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { claimEventsQuery, listClaimsQuery, startTaskSchema } from './schemas.ts';

describe('claim schemas', () => {
  it('defaults list filters to open claims', () => {
    assert.deepEqual(v.parse(listClaimsQuery, {}), {
      status: 'open',
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc'
    });
    assert.equal(v.safeParse(listClaimsQuery, { sort: 'balance', dir: 'asc' }).success, true);
    assert.equal(v.safeParse(listClaimsQuery, { sort: 'payer' }).success, false);
    assert.deepEqual(
      v.parse(listClaimsQuery, { status: 'all', lastName: ' smith ' }).lastName,
      'smith'
    );
    assert.equal(v.safeParse(listClaimsQuery, { status: 'needs_review' }).success, false);
    assert.equal(v.safeParse(listClaimsQuery, { status: 'pending' }).success, false);
    assert.equal(v.safeParse(listClaimsQuery, { birthDate: '01/02/1980' }).success, false);
    assert.equal(v.parse(listClaimsQuery, { number: ' 42 ' }).number, '42');
    assert.equal(v.safeParse(listClaimsQuery, { patientId: 'x' }).success, false);
    assert.equal(v.parse(listClaimsQuery, { sort: 'waiting' }).sort, 'waiting');
    assert.equal(v.parse(listClaimsQuery, { sort: 'encounter' }).sort, 'encounter');
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
    assert.deepEqual(v.parse(claimEventsQuery, {}), {
      page: 1,
      pageSize: 25,
      sort: 'when',
      dir: 'desc'
    });
    assert.deepEqual(
      v.parse(claimEventsQuery, { page: '3', pageSize: '100', sort: 'payer', dir: 'asc' }),
      { page: 3, pageSize: 100, sort: 'payer', dir: 'asc' }
    );
    const fails = (schema: typeof claimEventsQuery | typeof listClaimsQuery, q: object) =>
      !v.safeParse(schema, q).success;
    assert.ok(fails(claimEventsQuery, { sort: 'created' }));
    assert.ok(fails(claimEventsQuery, { dir: 'up' }));
    assert.ok(fails(listClaimsQuery, { page: '0' }));
    assert.ok(fails(listClaimsQuery, { page: '1.5' }));
    assert.ok(fails(listClaimsQuery, { pageSize: '7' }));
    assert.ok(fails(listClaimsQuery, { number: 'x'.repeat(41) }));
  });
});
