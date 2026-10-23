import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { App, type AppClients, type RouteContext, resolveRoute, Workspace } from './app.tsx';
import { idleLive } from './shared/testing.ts';

const clients = {
  auth: { signIn: async () => null, signOut: async () => undefined, getMe: async () => null },
  workflows: { list: async () => [] },
  runs: { list: async () => [] },
  tasks: { queues: async () => [], mine: async () => [] }
} as unknown as AppClients;

const query = (search = '') => new URLSearchParams(search);

const ctx: RouteContext = {
  ...clients,
  live: idleLive
};

describe('app routing', () => {
  it('resolves every section and rejects unknown paths', () => {
    for (const path of [
      '/workflows',
      '/workflows/g1',
      '/runs',
      '/runs/new',
      '/runs/r1',
      '/tasks',
      '/tasks/t1',
      '/imports',
      '/claims',
      '/claims/c1',
      '/submissions',
      '/fees',
      '/settings'
    ]) {
      assert.notEqual(resolveRoute(path, query('graph=g1'), ctx), null, path);
    }
    assert.equal(resolveRoute('/nope', query(), ctx), null);
  });

  it('renders the workspace shell with the active section and page', () => {
    const html = renderToStaticMarkup(
      createElement(Workspace, {
        clients,
        path: '/runs',
        query: query('status=faulted'),
        email: 'dev@example.com',
        sseUrl: 'http://localhost:3002',
        onSignOut: () => undefined
      })
    );
    assert.ok(
      html.includes('aria-current="page" href="/runs"') ||
        html.includes('href="/runs" aria-current="page"')
    );
    assert.ok(html.includes('dev@example.com'));
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('Runs'));
  });

  it('renders nothing until the session check completes', () => {
    assert.equal(renderToStaticMarkup(createElement(App, { clients })), '');
  });
});
