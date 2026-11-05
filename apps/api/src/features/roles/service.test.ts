import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { PERMISSIONS, type Permission, USER_ADMIN_PERMISSIONS } from '@ugula/access';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { testAccess } from '../../shared/testing.ts';
import { createRoleService, toRole } from './service.ts';

const updatedAt = new Date('2026-01-01T00:00:00Z');

const roleRow = (permissions: readonly string[], users = 0) => ({
  id: 'r-1',
  name: 'Biller',
  version: 2,
  updated_at: updatedAt,
  permissions: [...permissions],
  users
});

type Rows = {
  role?: ReturnType<typeof roleRow> & { total?: string };
  admin?: boolean;
  updated?: boolean;
  fail?: (q: CompiledQuery) => Error | null;
};

const roleDb = (rows: Rows) =>
  createRecordingDb((q) => {
    const err = rows.fail?.(q);
    if (err) throw err;
    if (q.sql.startsWith('select') && q.sql.includes('from "roles" as "r"')) {
      return rows.role ? [rows.role] : [];
    }
    if (q.sql.startsWith('select exists')) return [{ found: rows.admin ?? false }];
    if (q.sql.startsWith('update "roles"')) return rows.updated === false ? [] : [{ id: 'r-1' }];
    if (q.sql.includes('returning "id"')) return [{ id: 'r-1' }];
    return [];
  });

const pgError = (code: string) => Object.assign(new Error(code), { code });

const input = (permissions: Permission[], version = 2) => ({
  name: 'Biller',
  permissions,
  version
});

const writes = (queries: CompiledQuery[]) =>
  queries
    .filter((q) => !q.sql.startsWith('select'))
    .map((q) => q.sql.split(' ').slice(0, 3).join(' '));

const ungrantable = {
  ok: false,
  failure: { code: 'forbidden', message: "You can't grant permissions you don't hold" }
};

describe('toRole', () => {
  it('drops unknown permissions and marks roles the holder could not grant', () => {
    const row = roleRow(['fees:read', 'nope', 'fees:update'], 3);
    assert.deepEqual(toRole(row, ['fees:read', 'fees:update']), {
      id: 'r-1',
      name: 'Biller',
      version: 2,
      users: 3,
      permissions: ['fees:read', 'fees:update'],
      isGrantable: true,
      updatedAt
    });
    assert.equal(toRole(row, ['fees:read']).isGrantable, false);
  });
});

describe('role service', () => {
  it('lists, finds and describes permissions against what the caller holds', async () => {
    const { db } = roleDb({ role: { ...roleRow(['fees:read']), total: '1' } });
    const service = createRoleService({ db });
    const access = testAccess(['roles:read', 'fees:read']);
    const page = await service.list(access, { page: 1, pageSize: 25, sort: 'name', dir: 'asc' });
    assert.ok(page.ok);
    assert.equal(page.value.total, 1);
    assert.equal(page.value.items[0]?.isGrantable, true);
    assert.equal((await service.find(access, 'r-1')).ok, true);
    const perms = service.permissions(access);
    assert.ok(perms.ok);
    assert.equal(perms.value.items.length, PERMISSIONS.length);
    assert.deepEqual(
      perms.value.items.filter((p) => p.isGrantable).map((p) => p.permission),
      ['roles:read', 'fees:read']
    );
    assert.ok(perms.value.items.every((p) => p.description.length > 0));
    await db.destroy();
  });

  it('reports missing roles', async () => {
    const { db } = roleDb({});
    const service = createRoleService({ db });
    const missing = { ok: false, failure: { code: 'not_found', message: 'Role not found' } };
    assert.deepEqual(await service.find(testAccess(), 'r-1'), missing);
    assert.deepEqual(await service.update(testAccess(), 'r-1', input([])), missing);
    assert.deepEqual(await service.remove(testAccess(), 'r-1'), missing);
    await db.destroy();
  });

  it('creates roles only with permissions the caller holds', async () => {
    const { db, queries } = roleDb({});
    const service = createRoleService({ db });
    assert.deepEqual(
      await service.create(testAccess(['roles:create']), { name: 'x', permissions: ['fees:read'] }),
      ungrantable
    );
    assert.equal(queries.length, 0);
    assert.deepEqual(
      await service.create(testAccess(), { name: 'x', permissions: ['fees:read'] }),
      {
        ok: true,
        value: { id: 'r-1' }
      }
    );
    assert.deepEqual(writes(queries), [
      'insert into "roles"',
      'delete from "role_permissions"',
      'insert into "role_permissions"'
    ]);
    await db.destroy();
  });

  it('turns a duplicate name into a conflict', async () => {
    const conflict = {
      ok: false,
      failure: { code: 'conflict', message: 'A role with that name exists' }
    };
    const { db } = roleDb({
      role: roleRow([]),
      fail: (q) => (/^(insert into|update) "roles"/.test(q.sql) ? pgError('23505') : null)
    });
    const service = createRoleService({ db });
    assert.deepEqual(await service.create(testAccess(), { name: 'x', permissions: [] }), conflict);
    assert.deepEqual(await service.update(testAccess(), 'r-1', input([])), conflict);
    await db.destroy();
  });

  it('updates under the agency lock and returns the saved role', async () => {
    const { db, queries } = roleDb({ role: roleRow(['fees:read']) });
    const res = await createRoleService({ db }).update(testAccess(), 'r-1', input(['fees:update']));
    assert.ok(res.ok);
    assert.ok(queries[0]?.sql.includes('for no key update'));
    assert.deepEqual(writes(queries), [
      'update "roles" set',
      'delete from "role_permissions"',
      'insert into "role_permissions"'
    ]);
    await db.destroy();
  });

  it('refuses to change roles holding or gaining permissions the caller lacks', async () => {
    const held = testAccess(['roles:update', 'fees:read']);
    const cases: [Permission[], Permission[]][] = [
      [['fees:update'], ['fees:read']],
      [['fees:read'], ['fees:update']]
    ];
    for (const [before, after] of cases) {
      const { db, queries } = roleDb({ role: roleRow(before) });
      assert.deepEqual(
        await createRoleService({ db }).update(held, 'r-1', input(after)),
        ungrantable
      );
      assert.deepEqual(writes(queries), []);
      await db.destroy();
    }
  });

  it('keeps a user admin in the agency when a used role loses user permissions', async () => {
    const last = roleDb({ role: roleRow(USER_ADMIN_PERMISSIONS, 2) });
    assert.deepEqual(
      await createRoleService({ db: last.db }).update(testAccess(), 'r-1', input(['fees:read'])),
      {
        ok: false,
        failure: {
          code: 'conflict',
          message: 'The agency needs at least one user who can manage users'
        }
      }
    );
    assert.ok(last.queries.some((q) => q.sql.includes('"m"."role_id" != $')));
    await last.db.destroy();
    const other = roleDb({
      role: roleRow(USER_ADMIN_PERMISSIONS, 2),
      admin: true
    });
    assert.equal(
      (await createRoleService({ db: other.db }).update(testAccess(), 'r-1', input([]))).ok,
      true
    );
    await other.db.destroy();
    const unused = roleDb({ role: roleRow(USER_ADMIN_PERMISSIONS, 0) });
    assert.equal(
      (await createRoleService({ db: unused.db }).update(testAccess(), 'r-1', input([]))).ok,
      true
    );
    await unused.db.destroy();
  });

  it('reports stale versions as conflicts', async () => {
    const { db, queries } = roleDb({ role: roleRow([]), updated: false });
    assert.deepEqual(await createRoleService({ db }).update(testAccess(), 'r-1', input([], 1)), {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'Someone else changed this role; reload it and try again'
      }
    });
    assert.deepEqual(writes(queries), ['update "roles" set']);
    await db.destroy();
  });

  it('deletes grantable roles and refuses ones still assigned', async () => {
    const { db } = roleDb({ role: roleRow(['fees:read']) });
    const service = createRoleService({ db });
    assert.deepEqual(await service.remove(testAccess(), 'r-1'), { ok: true, value: { id: 'r-1' } });
    assert.deepEqual(await service.remove(testAccess(['roles:delete']), 'r-1'), ungrantable);
    await db.destroy();
    const used = roleDb({
      role: roleRow([]),
      fail: (q) => (q.sql.startsWith('delete from "roles"') ? pgError('23503') : null)
    });
    assert.deepEqual(await createRoleService({ db: used.db }).remove(testAccess(), 'r-1'), {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'Users still have this role; give them another role first'
      }
    });
    await used.db.destroy();
  });
});
