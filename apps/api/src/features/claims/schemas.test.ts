import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CLAIM_TASK_KEYS } from '@ugula/billing';
import * as v from 'valibot';
import {
  documentParam,
  listClaimEventsQuery,
  searchClaimsQuery,
  startTaskSchema
} from './schemas.ts';

const issues = (schema: v.GenericSchema, input: unknown) =>
  v.safeParse(schema, input).issues?.map((i) => i.message);

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

describe('searchClaimsQuery', () => {
  it('defaults to the first page of every claim, newest first', () => {
    assert.deepEqual(v.parse(searchClaimsQuery, {}), {
      status: [],
      waiting: [],
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc'
    });
  });

  it('trims the name and number filters and keeps the other filters', () => {
    assert.deepEqual(
      v.parse(searchClaimsQuery, {
        status: 'denied,paid',
        waiting: 'billing-review,none',
        firstName: ' ann ',
        lastName: ' smith ',
        birthDate: '1980-01-02',
        number: ' 42 ',
        patientId: ID,
        page: '2',
        pageSize: '50',
        sort: 'balance',
        dir: 'asc'
      }),
      {
        status: ['denied', 'paid'],
        waiting: ['billing-review', 'none'],
        firstName: 'ann',
        lastName: 'smith',
        birthDate: '1980-01-02',
        number: '42',
        patientId: ID,
        page: 2,
        pageSize: 50,
        sort: 'balance',
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
      'balance',
      'status',
      'waiting'
    ]) {
      assert.equal(v.parse(searchClaimsQuery, { sort }).sort, sort);
    }
    assert.deepEqual(issues(searchClaimsQuery, { sort: 'payer' }), [
      'Invalid type: Expected ("created" | "number" | "service" | "patient" | "pcr" | ' +
        '"encounter" | "total" | "balance" | "status" | "waiting") but received "payer"'
    ]);
  });

  it('filters only by known statuses and short waiting queues', () => {
    assert.equal(v.safeParse(searchClaimsQuery, { status: 'paid,open' }).success, false);
    assert.deepEqual(issues(searchClaimsQuery, { waiting: 'x'.repeat(61) }), [
      'Invalid length: Expected <=60 but received 61'
    ]);
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

describe('listClaimEventsQuery', () => {
  it('defaults to the first page of history, newest first', () => {
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
  });

  it('sorts history only by its own columns and directions', () => {
    assert.deepEqual(issues(listClaimEventsQuery, { sort: 'created' }), [
      'Invalid type: Expected ("when" | "event" | "payer" | "amount") but received "created"'
    ]);
    assert.deepEqual(issues(listClaimEventsQuery, { dir: 'up' }), [
      'Invalid type: Expected ("asc" | "desc") but received "up"'
    ]);
  });
});

describe('startTaskSchema', () => {
  it('starts only the claim task workflows a biller may start', () => {
    assert.deepEqual(v.parse(startTaskSchema, { workflow: 'billing.post-payment' }), {
      workflow: 'billing.post-payment'
    });
    assert.deepEqual(issues(startTaskSchema, { workflow: 'billing.cycle-claim' }), [
      `Invalid type: Expected (${CLAIM_TASK_KEYS.map((k) => `"${k}"`).join(' | ')}) ` +
        'but received "billing.cycle-claim"'
    ]);
    assert.deepEqual(issues(startTaskSchema, {}), [
      'Invalid key: Expected "workflow" but received undefined'
    ]);
  });
});

describe('documentParam', () => {
  it('requires a claim id and a document id', () => {
    assert.deepEqual(v.parse(documentParam, { id: ID, documentId: ID }), {
      id: ID,
      documentId: ID
    });
    assert.deepEqual(issues(documentParam, { id: ID, documentId: 'x' }), [
      'Invalid UUID: Received "x"'
    ]);
  });
});
