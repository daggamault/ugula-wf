import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS } from './permissions.ts';
import { BUILT_IN_ROLES, canGrant, isUserAdmin, USER_ADMIN_PERMISSIONS } from './roles.ts';

const role = (name: string) => BUILT_IN_ROLES.find((r) => r.name === name)?.permissions ?? [];

describe('roles', () => {
  it('grants only permissions the granter holds', () => {
    assert.equal(canGrant(['claims:read', 'claims:update'], ['claims:read']), true);
    assert.equal(canGrant(['claims:read'], ['claims:read', 'claims:update']), false);
    assert.equal(canGrant([], []), true);
  });

  it('treats a user as an admin only with every users permission', () => {
    assert.deepEqual(USER_ADMIN_PERMISSIONS, [
      'users:create',
      'users:read',
      'users:update',
      'users:delete'
    ]);
    assert.equal(isUserAdmin(USER_ADMIN_PERMISSIONS), true);
    assert.equal(isUserAdmin(['users:create', 'users:read', 'users:update']), false);
  });

  it('ships built-in roles of shrinking reach, each with valid unique permissions', () => {
    assert.deepEqual(
      BUILT_IN_ROLES.map((r) => r.name),
      ['Admin', 'Billing Manager', 'Biller', 'Viewer']
    );
    for (const r of BUILT_IN_ROLES) {
      assert.equal(new Set(r.permissions).size, r.permissions.length, r.name);
      assert.ok(canGrant(PERMISSIONS, r.permissions), r.name);
    }
    assert.deepEqual(role('Admin'), PERMISSIONS);
    assert.ok(canGrant(role('Billing Manager'), role('Biller')));
    assert.ok(role('Viewer').every((p) => p.endsWith(':read')));
    assert.ok(canGrant(role('Biller'), role('Viewer')));
  });

  it('lets a billing manager customize rules but not manage workflows or users', () => {
    const manager = role('Billing Manager');
    assert.ok(manager.includes('workflows:update') && manager.includes('claims:update'));
    assert.ok(!manager.includes('workflows:manage'));
    assert.equal(isUserAdmin(manager), false);
    assert.ok(!role('Biller').includes('workflows:update'));
  });

  it('lets billing managers, not billers, approve refunds, write-offs and collections', () => {
    assert.ok(role('Billing Manager').includes('claims:approve'));
    assert.ok(!role('Biller').includes('claims:approve'));
  });
});
