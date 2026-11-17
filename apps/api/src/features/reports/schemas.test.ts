import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { isTimeZone, reportParam, reportQuery } from './schemas.ts';

const issues = (input: unknown) => v.safeParse(reportQuery, input).issues?.map((i) => i.message);

describe('reportQuery', () => {
  it('defaults to UTC and the first page', () => {
    assert.deepEqual(v.parse(reportQuery, {}), { tz: 'UTC', page: 1 });
  });

  it('accepts an ordered pair of dates, a time zone, a group and a page', () => {
    assert.deepEqual(
      v.parse(reportQuery, {
        from: '2026-01-01',
        to: '2026-01-31',
        tz: 'America/Denver',
        group: 'class',
        page: '2',
        all: 'false'
      }),
      { from: '2026-01-01', to: '2026-01-31', tz: 'America/Denver', group: 'class', page: 2 }
    );
  });

  it('accepts a single day and an open-ended range', () => {
    assert.deepEqual(v.parse(reportQuery, { from: '2026-01-31', to: '2026-01-31' }), {
      from: '2026-01-31',
      to: '2026-01-31',
      tz: 'UTC',
      page: 1
    });
    assert.deepEqual(v.parse(reportQuery, { to: '2026-01-31' }), {
      to: '2026-01-31',
      tz: 'UTC',
      page: 1
    });
  });

  it('asks for every row in place of a page', () => {
    assert.deepEqual(v.parse(reportQuery, { page: '4', all: 'true' }), { tz: 'UTC', page: 'all' });
  });

  it('rejects a start after the end', () => {
    assert.deepEqual(issues({ from: '2026-02-01', to: '2026-01-31' }), [
      'The start date must be before the end date'
    ]);
  });

  it('rejects malformed dates and unknown or long time zones', () => {
    assert.deepEqual(issues({ from: '01/01/2026' }), ['Use a date like 2026-10-01']);
    assert.deepEqual(issues({ tz: 'Nowhere/Town' }), ['Use a time zone like America/New_York']);
    assert.deepEqual(issues({ tz: 'x'.repeat(65) }), [
      'Invalid length: Expected <=64 but received 65',
      'Use a time zone like America/New_York'
    ]);
  });

  it('rejects malformed groups, pages and all flags', () => {
    for (const bad of [
      { group: 'Payer' },
      { group: 'x'.repeat(33) },
      { page: '1.5' },
      { page: '0' },
      { page: '1000001' },
      { all: 'yes' }
    ]) {
      assert.equal(v.safeParse(reportQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('reportParam', () => {
  it('takes a lower-case report id of up to 32 letters and dashes', () => {
    assert.deepEqual(v.parse(reportParam, { id: 'write-offs' }), { id: 'write-offs' });
    for (const id of ['../x', 'Aging', '', 'x'.repeat(33)]) {
      assert.equal(v.safeParse(reportParam, { id }).success, false, id);
    }
  });
});

describe('isTimeZone', () => {
  it('knows IANA zones', () => {
    assert.equal(isTimeZone('America/New_York'), true);
    assert.equal(isTimeZone('UTC'), true);
  });

  it('refuses unknown zones', () => {
    assert.equal(isTimeZone('Mars/Base'), false);
  });
});
