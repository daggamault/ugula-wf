import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { titleCaseLabel } from '../../shared/format.ts';
import { findReport, groupOf, REPORTS } from './catalog.ts';

describe('report catalog', () => {
  it('gives each report a unique URL-safe id and a Title Case title with a sentence describing it', () => {
    assert.equal(new Set(REPORTS.map((r) => r.id)).size, REPORTS.length);
    assert.equal(new Set(REPORTS.map((r) => r.title)).size, REPORTS.length);
    for (const r of REPORTS) {
      assert.match(r.id, /^[a-z]+(-[a-z]+)*$/);
      assert.equal(r.title, titleCaseLabel(r.title));
      assert.match(r.description, /^[A-Z].*\.$/);
      assert.equal(findReport(r.id), r);
    }
    assert.equal(findReport('nope'), undefined);
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
    assert.equal(groupOf(aging, null)?.value, 'payer');
    assert.equal(groupOf({ groups: null }, 'class'), null);
  });
});
