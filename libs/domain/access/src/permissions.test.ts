import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  grantsOf,
  isPermission,
  PERMISSION_ACTIONS,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_RESOURCES,
  PERMISSIONS
} from './permissions.ts';

describe('permissions', () => {
  it('describes every permission, each a known resource and action, once', () => {
    assert.deepEqual(Object.keys(PERMISSION_DESCRIPTIONS).sort(), [...PERMISSIONS].sort());
    assert.equal(new Set(PERMISSIONS).size, PERMISSIONS.length);
    for (const p of PERMISSIONS) {
      const [resource, action] = p.split(':');
      assert.ok((PERMISSION_RESOURCES as readonly string[]).includes(resource ?? ''), p);
      assert.ok((PERMISSION_ACTIONS as readonly string[]).includes(action ?? ''), p);
    }
    for (const r of PERMISSION_RESOURCES) assert.ok(PERMISSIONS.some((p) => p.startsWith(`${r}:`)));
  });

  it('recognizes only listed permissions', () => {
    assert.equal(isPermission('claims:read'), true);
    assert.equal(isPermission('claims:manage'), false);
    assert.equal(isPermission('claims'), false);
  });

  it('grants the listed actions on the listed resources, in catalog order', () => {
    assert.deepEqual(grantsOf(['users']), [
      'users:create',
      'users:read',
      'users:update',
      'users:delete'
    ]);
    assert.deepEqual(grantsOf(['workflows', 'claims'], ['read']), [
      'claims:read',
      'workflows:read'
    ]);
    assert.deepEqual(grantsOf(['reports'], ['update']), []);
    assert.deepEqual(grantsOf([]), []);
  });
});
