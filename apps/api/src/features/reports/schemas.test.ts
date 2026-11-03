import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { isTimeZone, reportParam, reportQuery } from './schemas.ts';

describe('reportQuery', () => {
  it('accepts an ordered pair of dates, a time zone, a group and a page', () => {
    assert.deepEqual(v.parse(reportQuery, {}), { tz: 'UTC', page: 1 });
    assert.deepEqual(
      v.parse(reportQuery, {
        from: '2026-01-01',
        to: '2026-01-31',
        tz: 'America/Denver',
        group: 'class',
        page: '2'
      }),
      { from: '2026-01-01', to: '2026-01-31', tz: 'America/Denver', group: 'class', page: 2 }
    );
    assert.deepEqual(v.parse(reportQuery, { page: '4', all: 'true' }), { tz: 'UTC', page: 'all' });
  });

  it('rejects reversed or malformed dates, zones, groups and pages', () => {
    for (const bad of [
      { from: '2026-02-01', to: '2026-01-31' },
      { from: '01/01/2026' },
      { tz: 'Nowhere/Town' },
      { group: 'Payer' },
      { page: '1.5' }
    ]) {
      assert.equal(v.safeParse(reportQuery, bad).success, false, JSON.stringify(bad));
    }
  });
});

describe('reportParam', () => {
  it('takes a lower-case report id', () => {
    assert.ok(v.safeParse(reportParam, { id: 'write-offs' }).success);
    assert.ok(!v.safeParse(reportParam, { id: '../x' }).success);
  });
});

describe('isTimeZone', () => {
  it('knows IANA zones', () => {
    assert.ok(isTimeZone('America/New_York') && isTimeZone('UTC'));
    assert.ok(!isTimeZone('Mars/Base'));
  });
});
