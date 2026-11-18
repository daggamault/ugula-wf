import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { STD_KINDS } from '@ugula/graph';
import { createElement } from 'react';
import { App } from './app.tsx';
import type { AuthClient, AuthSession } from './features/auth/client.ts';
import type { QueueSummary } from './features/tasks/client.ts';
import type { AppClients } from './routes.tsx';
import type { Access, Agency } from './shared/access.tsx';
import { testNodes } from './shared/testing.ts';
import { act, render, screen, userEvent, waitFor, within } from './shared/testing-dom.ts';

const NORTH = '0b7e6a52-3c1d-4f8e-9a2b-5d6c7e8f9a0b';
const SOUTH = '1c8f7b63-4d2e-4a9f-8b3c-6e7d8f9a0b1c';

const agencies: Agency[] = [
  { id: NORTH, name: 'North EMS', organizationId: 'o1', organizationName: 'Acme' },
  { id: SOUTH, name: 'South EMS', organizationId: 'o1', organizationName: 'Acme' }
];

const session: AuthSession = {
  user: {
    id: 'u1',
    email: 'dev@example.com',
    firstName: 'Dev',
    lastName: 'User',
    type: 'organization',
    isOwner: false,
    organizationId: 'o1',
    organizationName: 'Acme'
  },
  sseUrl: 'http://sse.test'
};

const accessTo = (agencyId: string, permissions: Permission[]): Access => {
  const agency = agencies.find((a) => a.id === agencyId);
  assert.ok(agency);
  return {
    agencyId,
    agencyName: agency.name,
    organizationId: agency.organizationId,
    organizationName: agency.organizationName,
    userId: 'u1',
    isOrganizationAdmin: false,
    permissions
  };
};

const queue = (name: string, open: number): QueueSummary => ({
  queue: name,
  open,
  unassigned: open,
  mine: 0,
  oldest: '2026-11-01T00:00:00.000Z'
});

class FakeEventSource {
  static readonly CLOSED = 2;
  static opened: FakeEventSource[] = [];
  readyState = 0;
  isClosed = false;
  onmessage: ((message: { data: string }) => void) | null = null;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readonly url: string;
  readonly init: EventSourceInit;
  constructor(url: string, init: EventSourceInit) {
    this.url = url;
    this.init = init;
    FakeEventSource.opened.push(this);
  }
  close() {
    this.isClosed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
}

const stream = () => {
  const [source] = FakeEventSource.opened;
  assert.ok(source);
  return source;
};

type Fakes = {
  auth?: Partial<AuthClient>;
  agencies?: () => Promise<Agency[]>;
  permissions?: Permission[];
  access?: (agencyId: string) => Promise<Access>;
  queues?: () => Promise<QueueSummary[]>;
};

const fakeClients = (fakes: Fakes = {}) => {
  const calls: string[] = [];
  const pending = () => new Promise<never>(() => undefined);
  const clients = {
    auth: {
      signIn: async () => session,
      signOut: async () => {
        calls.push('signOut');
      },
      getMe: async () => {
        calls.push('getMe');
        return session;
      },
      onExpired: () => () => undefined,
      previewInvitation: (token: string) => {
        calls.push(`previewInvitation ${token}`);
        return pending();
      },
      acceptInvitation: pending,
      setPassword: async () => undefined,
      ...fakes.auth
    },
    agencies: {
      list: async () => {
        calls.push('agencies');
        return fakes.agencies ? fakes.agencies() : agencies;
      },
      access: async (agencyId: string) => {
        calls.push(`access ${agencyId}`);
        return fakes.access
          ? fakes.access(agencyId)
          : accessTo(agencyId, fakes.permissions ?? ['claims:read']);
      }
    },
    tasks: { queues: fakes.queues ?? (async () => []) },
    notifications: {
      list: async () => ({ items: [], unread: 0 }),
      record: async (toast: unknown) => {
        calls.push(`record ${JSON.stringify(toast)}`);
      },
      read: async () => undefined,
      clear: async () => undefined
    },
    runs: { search: pending, list: pending }
  } as unknown as AppClients;
  return { clients, calls };
};

const show = (path: string, fakes: Fakes = {}) => {
  window.history.replaceState(null, '', path);
  const fake = fakeClients(fakes);
  const view = render(
    createElement(App, { clients: fake.clients, nodes: testNodes, kinds: STD_KINDS, events: [] })
  );
  return { ...fake, ...view };
};

const nav = () => screen.getAllByRole('navigation', { name: 'Primary' })[0] as HTMLElement;

const claimsPage = () => screen.findByRole('heading', { name: 'Claims' });

const realEventSource = globalThis.EventSource;

before(() => {
  Object.assign(globalThis, { EventSource: FakeEventSource });
});

after(() => {
  Object.assign(globalThis, { EventSource: realEventSource });
});

beforeEach(() => {
  FakeEventSource.opened = [];
  localStorage.clear();
});

describe('App', () => {
  it('opens an invitation link without checking the session', async () => {
    const { calls } = show('/invitation?token=t1');
    await waitFor(() => assert.equal(window.location.search, ''));
    assert.equal(window.location.pathname, '/invitation');
    assert.deepEqual(calls, ['previewInvitation t1']);
  });

  it('opens a password link without checking the session', async () => {
    const { calls } = show('/password?token=t2');
    assert.ok(screen.getByText('Set Your Password'));
    await waitFor(() => assert.equal(window.location.search, ''));
    assert.deepEqual(calls, []);
  });

  it('shows nothing until the session check completes', () => {
    const { container } = show('/', { auth: { getMe: () => new Promise(() => undefined) } });
    assert.equal(container.innerHTML, '');
  });

  it('asks a signed-out user to sign in', async () => {
    const { calls } = show('/claims', { auth: { getMe: async () => null } });
    assert.ok(await screen.findByRole('button', { name: 'Sign In' }));
    assert.deepEqual(calls, []);
  });
});

describe('AgencyGate', () => {
  it('opens the only agency without asking, keeping the page and its query', async () => {
    const { calls } = show('/claims?x=1', { agencies: async () => [agencies[0] as Agency] });
    await claimsPage();
    assert.equal(window.location.pathname, `/agencies/${NORTH}/claims`);
    assert.equal(window.location.search, '?x=1');
    assert.deepEqual(calls, ['getMe', 'agencies', `access ${NORTH}`]);
  });

  it('reopens the agency opened last time', async () => {
    localStorage.setItem('ugula.agency', SOUTH);
    show('/claims');
    await claimsPage();
    assert.equal(window.location.pathname, `/agencies/${SOUTH}/claims`);
  });

  it('remembers the agency it opens', async () => {
    show(`/agencies/${SOUTH}/claims`);
    await claimsPage();
    assert.equal(localStorage.getItem('ugula.agency'), SOUTH);
  });

  it('asks which agency to open when several are available', async () => {
    const { calls } = show('/claims');
    await screen.findByRole('link', { name: 'North EMS Acme' });
    const links = within(screen.getByRole('region', { name: 'Choose an Agency' })).getAllByRole(
      'link'
    );
    assert.deepEqual(
      links.map((l) => l.getAttribute('href')),
      [`/agencies/${NORTH}`, `/agencies/${SOUTH}`]
    );
    assert.equal(window.location.pathname, '/claims');
    assert.deepEqual(calls, ['getMe', 'agencies']);
  });

  it('shows a loading state while the agency access loads', async () => {
    show(`/agencies/${NORTH}/claims`, { access: () => new Promise(() => undefined) });
    assert.ok(await screen.findByRole('status', { name: 'Loading' }));
    assert.ok(!screen.queryByRole('navigation'));
  });

  it('explains when the agencies cannot be loaded', async () => {
    show('/claims', {
      agencies: async () => {
        throw new Error('Agencies are down');
      }
    });
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(screen.getByText('Agencies are down'));
  });

  it('offers the other agencies when the chosen one cannot be opened', async () => {
    show(`/agencies/${NORTH}/claims`, {
      access: async () => {
        throw new Error('Forbidden');
      }
    });
    await waitFor(() =>
      assert.equal(
        screen.getByRole('status').textContent,
        'You cannot open that agency. Choose another.'
      )
    );
    assert.equal(screen.getAllByRole('link').length, 2);
    assert.equal(localStorage.getItem('ugula.agency'), null);
  });
});

describe('Workspace', () => {
  it('lists only the sections the role may open and marks the current one', async () => {
    show(`/agencies/${NORTH}/claims`, {
      permissions: ['claims:read', 'fees:read']
    });
    await claimsPage();
    const links = within(nav()).getAllByRole('link');
    assert.deepEqual(
      links.map((l) => [l.textContent, l.getAttribute('href'), l.getAttribute('aria-current')]),
      [
        ['Claims', `/agencies/${NORTH}/claims`, 'page'],
        ['Reports', `/agencies/${NORTH}/reports`, null],
        ['Fees', `/agencies/${NORTH}/fees`, null]
      ]
    );
  });

  it('shows the signed-in email and the open agency', async () => {
    show(`/agencies/${NORTH}/claims`);
    await claimsPage();
    assert.ok(screen.getAllByText('dev@example.com').length > 0);
    assert.ok(screen.getAllByText('Switch agency').length > 0);
    assert.ok(screen.getAllByText('North EMS').length > 0);
  });

  it('opens the first section the role may see when the path is unknown', async () => {
    show(`/agencies/${NORTH}/nope`, { permissions: ['fees:read', 'claims:read'] });
    await claimsPage();
    assert.equal(window.location.pathname, `/agencies/${NORTH}/claims`);
  });

  it('explains when the role opens no sections', async () => {
    show(`/agencies/${NORTH}/`, { permissions: [] });
    assert.ok(await screen.findByRole('heading', { name: 'Something Went Wrong' }));
    assert.ok(
      screen.getByText(
        'Your role in this agency opens no sections. Ask an administrator for access.'
      )
    );
    assert.equal(window.location.pathname, `/agencies/${NORTH}/`);
  });

  it('expands the group holding the current section', async () => {
    show(`/agencies/${NORTH}/runs`, { permissions: ['runs:read', 'payers:read'] });
    await waitFor(() => assert.ok(nav()));
    const groups = within(nav()).getAllByRole('button');
    assert.deepEqual(
      groups.map((b) => [b.textContent, b.getAttribute('aria-expanded')]),
      [
        ['Automation', 'true'],
        ['Admin', 'false']
      ]
    );
  });

  it('shows the open task count on the tasks link', async () => {
    show(`/agencies/${NORTH}/claims`, {
      permissions: ['tasks:read', 'claims:read'],
      queues: async () => [queue('billing-review', 2), queue('billing-patients', 1)]
    });
    await claimsPage();
    await waitFor(() =>
      assert.equal(within(nav()).getAllByRole('link')[0]?.textContent, 'Tasks3 open')
    );
  });

  it('announces new tasks as they arrive without recording them as notifications', async () => {
    let open = 1;
    const { calls } = show(`/agencies/${NORTH}/claims`, {
      permissions: ['tasks:read', 'claims:read'],
      queues: async () => [queue('billing-review', open)]
    });
    await claimsPage();
    await waitFor(() =>
      assert.equal(within(nav()).getAllByRole('link')[0]?.textContent, 'Tasks1 open')
    );
    open = 3;
    await act(async () => stream().onmessage?.({ data: '{"kind":"task","id":"t9"}' }));
    assert.ok(await screen.findByText('2 new tasks in Billing Review'));
    assert.deepEqual(
      calls.filter((c) => c.startsWith('record')),
      []
    );
  });

  it('connects live updates for the agency and shows when they are on', async () => {
    show(`/agencies/${NORTH}/claims`);
    await claimsPage();
    assert.deepEqual(
      FakeEventSource.opened.map((s) => [s.url, s.init]),
      [[`http://sse.test/events?agency=${NORTH}`, { withCredentials: true }]]
    );
    const status = () => screen.getAllByRole('status').map((s) => s.textContent);
    assert.ok(status().includes('Connecting to live updates'));
    await act(async () => stream().onopen?.());
    assert.ok(status().includes('Live updates on'));
  });

  it('closes live updates when the workspace closes', async () => {
    const { unmount } = show(`/agencies/${NORTH}/claims`);
    await claimsPage();
    assert.equal(stream().isClosed, false);
    unmount();
    assert.equal(stream().isClosed, true);
  });

  it('signs out from the workspace', async () => {
    const { calls } = show(`/agencies/${NORTH}/claims`);
    await claimsPage();
    const [signOut] = screen.getAllByRole('button', { name: 'Sign Out' });
    assert.ok(signOut);
    await userEvent.setup().click(signOut);
    assert.ok(await screen.findByRole('button', { name: 'Sign In' }));
    assert.deepEqual(calls, ['getMe', 'agencies', `access ${NORTH}`, 'signOut']);
  });
});
