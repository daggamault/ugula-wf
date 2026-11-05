import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { homeOf, SECTIONS } from './sections.ts';

describe('SECTIONS', () => {
  it('gives every section its own id and link', () => {
    assert.equal(new Set(SECTIONS.map((s) => s.id)).size, SECTIONS.length);
    assert.equal(new Set(SECTIONS.map((s) => s.href)).size, SECTIONS.length);
  });
});

describe('homeOf', () => {
  it('opens claims when the role may see them, else its first section, else nothing', () => {
    const holding =
      (...held: string[]) =>
      (permission: string) =>
        held.includes(permission);
    assert.equal(homeOf(holding('patients:read', 'claims:read')), '/claims');
    assert.equal(homeOf(holding('users:read', 'fees:read')), '/fees');
    assert.equal(homeOf(holding()), null);
  });
});
