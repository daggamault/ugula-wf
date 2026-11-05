import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ReactElement } from 'react';
import { type AppClients, type RouteContext, resolveRoute } from './routes.tsx';
import { idleLive, testNodes } from './shared/testing.ts';

const clients = {
  auth: { signIn: async () => null, signOut: async () => undefined, getMe: async () => null },
  agencies: { list: () => new Promise(() => undefined), access: async () => null },
  workflows: { list: async () => [] },
  runs: { list: async () => [] },
  tasks: { queues: async () => [] },
  notifications: { list: () => new Promise(() => undefined) }
} as unknown as AppClients;

const query = (search = '') => new URLSearchParams(search);

const ctx: RouteContext = {
  ...clients,
  nodes: testNodes,
  live: idleLive,
  email: 'dev@example.com'
};

describe('resolveRoute', () => {
  it('resolves every section and rejects unknown paths', () => {
    for (const path of [
      '/workflows',
      '/workflows/new',
      '/workflows/customized',
      '/workflows/g1',
      '/tables',
      '/tables/t1',
      '/runs',
      '/runs/new',
      '/runs/r1',
      '/tasks/t1',
      '/imports',
      '/imports/i1',
      '/claims',
      '/claims/c1',
      '/patients',
      '/patients/p1',
      '/reports',
      '/payer-files',
      '/payer-files/f1',
      '/reports/aging',
      '/reports/aging/results',
      '/fees',
      '/fees/new',
      '/fees/f1',
      '/payers',
      '/payers/new',
      '/payers/p1',
      '/users',
      '/users/invite',
      '/users/invitations',
      '/users/u1',
      '/roles',
      '/roles/new',
      '/roles/r1',
      '/settings'
    ]) {
      assert.notEqual(resolveRoute(path, query('graph=g1'), ctx), null, path);
    }
    assert.equal(resolveRoute('/nope', query(), ctx), null);
    assert.equal(resolveRoute('/tasks', query(), ctx), null);
  });

  it('reads page state from the URL and drops values it does not know', () => {
    const props = (path: string, search: string) =>
      (resolveRoute(path, query(search), ctx) as ReactElement<Record<string, unknown>>).props;
    assert.equal(props('/runs/new', 'graph=g1').graphId, 'g1');
    assert.equal(props('/runs', 'status=faulted').status, 'faulted');
    assert.equal(props('/runs', 'status=bogus').status, null);
    assert.equal(props('/claims/c1', 'tab=data').tab, 'data');
    assert.equal(props('/claims/c1', 'tab=bogus').tab, 'overview');
    assert.equal(props('/claims/c1', 'back=/patients/p1').back, '/patients/p1');
    assert.equal(props('/claims/c1', 'back=https://evil.test').back, '/claims');
    assert.equal(props('/workflows/g1', 'version=3').version, 3);
    assert.equal(props('/workflows/g1', 'version=0').version, null);
    assert.equal(props('/workflows/customized', 'all=shown').showAll, true);
    assert.equal(props('/tables/t1', 'version=2').version, 2);
    assert.equal(props('/tables', 'show=customized').show, 'customized');
    assert.equal(props('/tasks/t1', '').back, null);
    assert.equal(props('/tasks/t1', 'back=/runs/r1').back, '/runs/r1');
    assert.equal(props('/fees/new', '').feeId, null);
    assert.equal(props('/payers/p1', '').payerId, 'p1');
    assert.equal(props('/users/u1', 'back=/users?q=a').userId, 'u1');
    assert.equal(props('/users/u1', 'back=/users?q=a').back, '/users?q=a');
    assert.equal(props('/users', '').tab, 'users');
    assert.equal(props('/users/invitations', '').tab, 'invitations');
    assert.equal(props('/roles/new', '').roleId, null);
    assert.equal(props('/roles/r1', '').roleId, 'r1');
  });
});
