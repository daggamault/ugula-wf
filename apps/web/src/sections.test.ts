import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { COLLAPSIBLE_GROUPS, homeOf, SECTIONS } from './sections.ts';

const holding =
  (...held: Permission[]) =>
  (permission: Permission) =>
    held.includes(permission);

describe('SECTIONS', () => {
  it('lists the sections in navigation order with their links, groups and permissions', () => {
    assert.deepEqual(
      SECTIONS.map((s) => [s.id, s.label, s.href, s.group, s.permission]),
      [
        ['tasks', 'Tasks', '/tasks', undefined, 'tasks:read'],
        ['patients', 'Patients', '/patients', undefined, 'patients:read'],
        ['imports', 'Imports', '/imports', undefined, 'imports:read'],
        ['claims', 'Claims', '/claims', undefined, 'claims:read'],
        ['reports', 'Reports', '/reports', undefined, 'claims:read'],
        ['workflows', 'Workflows', '/workflows', 'Automation', 'workflows:read'],
        ['tables', 'Tables', '/tables', 'Automation', 'workflows:read'],
        ['runs', 'Runs', '/runs', 'Automation', 'runs:read'],
        ['payers', 'Payers', '/payers', 'Admin', 'payers:read'],
        ['facilities', 'Facilities', '/facilities', 'Admin', 'facilities:read'],
        ['fees', 'Fees', '/fees', 'Admin', 'fees:read'],
        ['users', 'Users', '/users', 'Admin', 'users:read'],
        ['roles', 'Roles', '/roles', 'Admin', 'roles:read'],
        ['settings', 'Settings', '/settings', 'Admin', 'settings:read']
      ]
    );
  });

  it('gives every section its own id and link', () => {
    assert.equal(new Set(SECTIONS.map((s) => s.id)).size, SECTIONS.length);
    assert.equal(new Set(SECTIONS.map((s) => s.href)).size, SECTIONS.length);
  });

  it('collapses exactly the groups the sections use', () => {
    assert.deepEqual(COLLAPSIBLE_GROUPS, ['Automation', 'Admin']);
    assert.deepEqual(
      [...new Set(SECTIONS.flatMap((s) => (s.group ? [s.group] : [])))],
      COLLAPSIBLE_GROUPS
    );
  });
});

describe('homeOf', () => {
  it('opens tasks when the role may see them, even if earlier-listed sections are open too', () => {
    assert.equal(homeOf(holding('patients:read', 'claims:read', 'tasks:read')), '/tasks');
  });

  it('otherwise opens the first section the role may see', () => {
    assert.equal(homeOf(holding('claims:read', 'patients:read')), '/patients');
    assert.equal(homeOf(holding('users:read', 'fees:read')), '/fees');
  });

  it('opens nothing for a role that may see no section', () => {
    assert.equal(homeOf(holding()), null);
  });
});
