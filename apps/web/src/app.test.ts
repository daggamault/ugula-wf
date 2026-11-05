import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AgencyGate, App, Workspace } from './app.tsx';
import type { AppClients } from './routes.tsx';
import { type Access, AccessProvider } from './shared/access.tsx';
import { testNodes } from './shared/testing.ts';

const clients = {
  auth: { signIn: async () => null, signOut: async () => undefined, getMe: async () => null },
  agencies: { list: () => new Promise(() => undefined), access: async () => null },
  workflows: { list: async () => [] },
  runs: { list: async () => [] },
  tasks: { queues: async () => [] },
  notifications: { list: () => new Promise(() => undefined) }
} as unknown as AppClients;

const query = (search = '') => new URLSearchParams(search);

const agency = { id: 'a1', name: 'North EMS', organizationId: 'o1', organizationName: 'Acme' };

const access: Access = {
  agencyId: 'a1',
  agencyName: 'North EMS',
  organizationId: 'o1',
  organizationName: 'Acme',
  userId: 'u1',
  isOrganizationAdmin: false,
  permissions: ['runs:read', 'claims:read']
};

describe('app', () => {
  it('renders the workspace shell with the active section, page and permitted sections', () => {
    const html = renderToStaticMarkup(
      createElement(AccessProvider, {
        access,
        children: createElement(Workspace, {
          clients,
          nodes: testNodes,
          path: '/runs',
          query: query('status=faulted'),
          email: 'dev@example.com',
          sseUrl: 'http://localhost:3002',
          agencies: [agency, { ...agency, id: 'a2', name: 'South EMS' }],
          onSignOut: () => undefined
        })
      })
    );
    assert.ok(
      html.includes('aria-current="page" href="/runs"') ||
        html.includes('href="/runs" aria-current="page"')
    );
    assert.ok(html.includes('dev@example.com'));
    assert.ok(html.includes('<h1'));
    assert.ok(html.includes('Runs') && html.includes('href="/claims"'));
    assert.ok(!html.includes('href="/users"') && !html.includes('href="/roles"'));
    assert.ok(!html.includes('href="/tasks"'));
    assert.match(html, /<button type="button" aria-expanded="true"[^>]*><span>Automation<\/span>/);
    assert.ok(html.includes('North EMS') && html.includes('Switch agency'));
  });

  it('waits for the agencies before opening one', () => {
    const html = renderToStaticMarkup(
      createElement(AgencyGate, {
        clients,
        nodes: testNodes,
        path: '/claims',
        query: query(),
        email: 'dev@example.com',
        sseUrl: 'http://localhost:3002',
        agencyId: null,
        userId: 'u1',
        onSignOut: () => undefined
      })
    );
    assert.ok(html.includes('aria-label="Loading"'));
  });

  it('renders nothing until the session check completes', () => {
    assert.equal(renderToStaticMarkup(createElement(App, { clients, nodes: testNodes })), '');
  });
});
