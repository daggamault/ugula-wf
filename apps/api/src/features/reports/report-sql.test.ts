import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { type Expression, sql } from 'kysely';
import {
  cents,
  centsWhere,
  count,
  countWhere,
  reasonCode,
  SUBMISSIONS,
  servedIn,
  UNBILLED,
  UNRECOVERED,
  within,
  zero
} from './report-sql.ts';
import { reportContext } from './report-testing.ts';

const compile = (expr: Expression<unknown>) =>
  createDummyDb().selectNoFrom(sql`${expr}`.as('v')).compile();

describe('report sql', () => {
  it('names the claim statuses reports filter on', () => {
    assert.deepEqual(UNBILLED, ['draft', 'void']);
    assert.deepEqual(SUBMISSIONS, ['submitted', 'resubmitted']);
    assert.deepEqual(UNRECOVERED, ['written_off', 'collections']);
  });

  it('sums and counts as numbers, never null', () => {
    assert.equal(compile(cents(sql.ref('x'))).sql, 'select coalesce(sum("x"), 0)::float8 as "v"');
    assert.equal(
      compile(centsWhere(sql.ref('x'), sql`y`)).sql,
      'select coalesce(sum("x") filter (where y), 0)::float8 as "v"'
    );
    assert.equal(compile(countWhere(sql`y`)).sql, 'select (count(*) filter (where y))::int as "v"');
    assert.equal(compile(count).sql, 'select count(*)::int as "v"');
    assert.equal(compile(zero).sql, 'select 0 as "v"');
    assert.equal(compile(reasonCode).sql, `select a.group_code || '-' || a.reason_code as "v"`);
  });

  it('bounds a timestamp by whole days in the agency time zone', () => {
    const q = compile(within(sql.ref('e.created_at'), reportContext));
    assert.equal(
      q.sql,
      'select "e"."created_at" >= ($1::date)::timestamp at time zone $2 and "e"."created_at" < ($3::date + 1)::timestamp at time zone $4 as "v"'
    );
    assert.deepEqual(q.parameters, [
      '2026-01-01',
      'America/New_York',
      '2026-10-23',
      'America/New_York'
    ]);
  });

  it('bounds the service date on its own indexed column', () => {
    const q = compile(servedIn(reportContext));
    assert.equal(q.sql, 'select c.service_date between $1::date and $2::date as "v"');
    assert.deepEqual(q.parameters, ['2026-01-01', '2026-10-23']);
  });
});
