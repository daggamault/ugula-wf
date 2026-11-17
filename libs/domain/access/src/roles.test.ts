import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from './permissions.ts';
import { BUILT_IN_ROLES, canGrant, isUserAdmin, USER_ADMIN_PERMISSIONS } from './roles.ts';

const role = (name: string) => BUILT_IN_ROLES.find((r) => r.name === name)?.permissions ?? [];

const lacks = (name: string) => PERMISSIONS.filter((p) => !role(name).includes(p));

const ALL_READS = PERMISSIONS.filter((p) => p.endsWith(':read'));

describe('canGrant', () => {
  it('grants only permissions the granter holds', () => {
    assert.equal(canGrant(['claims:read', 'tasks:read'], ['claims:read']), true);
    assert.equal(canGrant(['claims:read'], ['claims:read', 'tasks:read']), false);
    assert.equal(canGrant([], ['claims:read']), false);
    assert.equal(canGrant([], []), true);
  });
});

describe('isUserAdmin', () => {
  it('treats a user as an admin only with every users permission', () => {
    assert.deepEqual(USER_ADMIN_PERMISSIONS, [
      'users:create',
      'users:read',
      'users:update',
      'users:delete'
    ]);
    assert.equal(isUserAdmin(USER_ADMIN_PERMISSIONS), true);
    assert.equal(isUserAdmin(PERMISSIONS), true);
    assert.equal(isUserAdmin(['users:create', 'users:read', 'users:update']), false);
    assert.equal(isUserAdmin([]), false);
  });
});

describe('BUILT_IN_ROLES', () => {
  it('ships four roles, each with unique permissions', () => {
    assert.deepEqual(
      BUILT_IN_ROLES.map((r) => r.name),
      ['Admin', 'Billing Manager', 'Biller', 'Viewer']
    );
    for (const r of BUILT_IN_ROLES) {
      assert.equal(new Set(r.permissions).size, r.permissions.length, r.name);
    }
  });

  it('gives the admin every permission', () => {
    assert.deepEqual(role('Admin'), PERMISSIONS);
  });

  it('lets a billing manager run billing and customize rules, but not manage workflows, users, roles or settings', () => {
    assert.deepEqual(lacks('Billing Manager'), [
      'settings:update',
      'users:create',
      'users:update',
      'users:delete',
      'roles:create',
      'roles:update',
      'roles:delete',
      'workflows:manage'
    ]);
    assert.equal(isUserAdmin(role('Billing Manager')), false);
  });

  it('lets a biller work claims and imports and only read the setup', () => {
    assert.deepEqual(role('Biller'), [
      'patients:read',
      'imports:create',
      'imports:read',
      'claims:read',
      'tasks:read',
      'tasks:update',
      'settings:read',
      'users:read',
      'roles:read',
      'payers:read',
      'facilities:read',
      'fees:read',
      'workflows:read',
      'runs:read'
    ]);
  });

  it('lets a viewer read everything and change nothing', () => {
    assert.deepEqual([...role('Viewer')].sort(), [...ALL_READS].sort());
  });

  it('shrinks in reach from admin to viewer', () => {
    assert.equal(canGrant(role('Admin'), role('Billing Manager')), true);
    assert.equal(canGrant(role('Billing Manager'), role('Biller')), true);
    assert.equal(canGrant(role('Biller'), role('Viewer')), true);
  });
});
