import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { titleCaseLabel } from '../../shared/format.ts';
import { findReport, groupOf, REPORTS } from './catalog.ts';

const groupsOf = (id: string) => findReport(id)?.groups?.map((g) => g.value) ?? null;

describe('report catalog', () => {
  it('lists the reports in order with the dates each one filters by', () => {
    assert.deepEqual(
      REPORTS.map((r) => [r.id, r.dates]),
      [
        ['aging', null],
        ['unbilled', null],
        ['monthly', 'service'],
        ['activity', 'posted'],
        ['payments', 'posted'],
        ['denials', 'posted'],
        ['write-offs', 'closed'],
        ['credit-balances', null],
        ['payers', 'service'],
        ['hcpcs', 'service'],
        ['work-queue', null],
        ['productivity', 'completed'],
        ['imports', 'received']
      ]
    );
  });

  it('gives each report a unique URL-safe id and Title Case title', () => {
    assert.equal(new Set(REPORTS.map((r) => r.id)).size, REPORTS.length);
    assert.equal(new Set(REPORTS.map((r) => r.title)).size, REPORTS.length);
    for (const r of REPORTS) {
      assert.match(r.id, /^[a-z]+(-[a-z]+)*$/);
      assert.equal(r.title, titleCaseLabel(r.title));
    }
  });

  it('describes each report in a sentence', () => {
    for (const r of REPORTS) assert.match(r.description, /^[A-Z].*\.$/, r.id);
  });

  it('finds reports by id and nothing for unknown ids', () => {
    for (const r of REPORTS) assert.equal(findReport(r.id), r);
    assert.equal(findReport('nope'), undefined);
    assert.equal(findReport(''), undefined);
  });

  it('offers groupings only on the reports that can be grouped', () => {
    assert.deepEqual(
      REPORTS.filter((r) => r.groups).map((r) => [r.id, groupsOf(r.id)]),
      [
        ['aging', ['payer', 'class', 'status']],
        ['denials', ['payer', 'reason']],
        ['payers', ['payer', 'class']],
        ['work-queue', ['queue', 'assignee']]
      ]
    );
  });

  it('labels every column and group once in Title Case', () => {
    for (const r of REPORTS) {
      for (const g of r.groups ?? []) assert.equal(g.label, titleCaseLabel(g.label), r.id);
      for (const group of r.groups?.map((g) => g.value) ?? [null]) {
        const labels = r.columns(group).map((c) => c.label);
        assert.equal(new Set(labels).size, labels.length, `${r.id} ${group}`);
        for (const l of labels) assert.equal(l, titleCaseLabel(l), `${r.id} ${l}`);
      }
    }
  });

  it('labels the first column for the chosen group', () => {
    const first = (id: string, group: string | null) => findReport(id)?.columns(group)[0]?.label;
    assert.equal(first('aging', 'payer'), 'Owed By');
    assert.equal(first('aging', 'class'), 'Financial Class');
    assert.equal(first('aging', 'status'), 'Status');
    assert.equal(first('work-queue', 'assignee'), 'Assignee');
  });
});

describe('groupOf', () => {
  const aging = findReport('aging');
  assert.ok(aging);

  it('finds the chosen group', () => {
    assert.deepEqual(groupOf(aging, 'class'), { value: 'class', label: 'Financial Class' });
  });

  it('falls back to the first group for unknown or missing values', () => {
    assert.deepEqual(groupOf(aging, 'bogus'), { value: 'payer', label: 'Payer' });
    assert.deepEqual(groupOf(aging, null), { value: 'payer', label: 'Payer' });
  });

  it('has no group for reports that cannot be grouped', () => {
    assert.equal(groupOf({ groups: null }, 'class'), null);
    assert.equal(groupOf({ groups: [] }, 'class'), null);
  });
});
