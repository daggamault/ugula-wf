import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { COLLAPSIBLE_GROUPS, homeOf, SECTIONS } from './sections.ts';

describe('SECTIONS', () => {
  it('gives every section its own id and link', () => {
    assert.equal(new Set(SECTIONS.map((s) => s.id)).size, SECTIONS.length);
    assert.equal(new Set(SECTIONS.map((s) => s.href)).size, SECTIONS.length);
  });

  it('starts with the task list, among the untitled work links', () => {
    assert.deepEqual(SECTIONS[0] && [SECTIONS[0].id, SECTIONS[0].href, SECTIONS[0].group], [
      'tasks',
      '/tasks',
      undefined
    ]);
  });

  it('collapses only groups that have sections', () => {
    assert.deepEqual(COLLAPSIBLE_GROUPS, ['Automation', 'Admin']);
    for (const group of COLLAPSIBLE_GROUPS) {
      assert.ok(
        SECTIONS.some((s) => s.group === group),
        group
      );
    }
  });
});

describe('homeOf', () => {
  it('opens tasks when the role may see them, else its first section, else nothing', () => {
    const holding =
      (...held: string[]) =>
      (permission: string) =>
        held.includes(permission);
    assert.equal(homeOf(holding('patients:read', 'claims:read', 'tasks:read')), '/tasks');
    assert.equal(homeOf(holding('patients:read', 'claims:read')), '/patients');
    assert.equal(homeOf(holding('users:read', 'fees:read')), '/fees');
    assert.equal(homeOf(holding()), null);
  });
});
