import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { findReport, groupOf, REPORTS } from './catalog.ts';

describe('report catalog', () => {
  it('describes each report once with the dates and groups it takes', () => {
    assert.deepEqual(
      REPORTS.map((r) => [r.id, r.dates, r.groups?.map((g) => g.value) ?? null]),
      [
        ['aging', null, ['payer', 'class']],
        ['unbilled', null, null],
        ['monthly', 'service', null],
        ['activity', 'posted', null],
        ['payments', 'posted', null],
        ['denials', 'posted', ['payer', 'reason']],
        ['write-offs', 'closed', null],
        ['payers', 'service', ['payer', 'class']],
        ['hcpcs', 'service', null],
        ['levels', 'service', null],
        ['work-queue', null, ['queue', 'assignee']],
        ['productivity', 'completed', null],
        ['imports', 'received', null]
      ]
    );
    assert.equal(new Set(REPORTS.map((r) => r.title)).size, REPORTS.length);
    assert.equal(findReport('nope'), undefined);
  });

  it('labels the first column for the chosen group', () => {
    const aging = findReport('aging');
    assert.equal(aging?.columns('payer')[0]?.label, 'Owed By');
    assert.equal(aging?.columns('class')[0]?.label, 'Financial Class');
    assert.equal(findReport('work-queue')?.columns('assignee')[0]?.label, 'Assignee');
  });

  it('falls back to the first group for unknown values', () => {
    const aging = findReport('aging');
    assert.ok(aging);
    assert.equal(groupOf(aging, 'class')?.label, 'Financial Class');
    assert.equal(groupOf(aging, 'bogus')?.value, 'payer');
    assert.equal(groupOf({ groups: null }, 'class'), null);
  });
});
