import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import {
  type Access,
  AccessProvider,
  type Agency,
  createAgenciesClient,
  rememberAgency,
  rememberedAgency,
  useAccess,
  useCan
} from './access.tsx';
import { createApi } from './api.ts';
import { render, screen } from './testing-dom.ts';

const access: Access = {
  agencyId: 'a1',
  agencyName: 'North EMS',
  organizationId: 'o1',
  organizationName: 'Acme',
  userId: 'u1',
  isOrganizationAdmin: false,
  permissions: ['claims:read']
};

const agencies: Agency[] = [
  { id: 'a1', name: 'North EMS', organizationId: 'o1', organizationName: 'Acme' },
  { id: 'a2', name: 'South EMS', organizationId: 'o1', organizationName: 'Acme' }
];

const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');

const stubStorage = (storage: Partial<Storage>) =>
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true });

afterEach(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original);
  else Reflect.deleteProperty(globalThis, 'localStorage');
  localStorage.clear();
});

const fakeAgencies = (permissions: string[] = ['claims:read']) => {
  const calls: { url: string; signal: AbortSignal | null | undefined }[] = [];
  const client = createAgenciesClient(
    createApi(
      'http://api.test',
      async (url, init) => {
        calls.push({ url: String(url), signal: init?.signal });
        const body = String(url).endsWith('/access')
          ? { ...access, permissions }
          : { items: agencies };
        return new Response(JSON.stringify(body), { status: 200 });
      },
      () => undefined,
      () => 'a9'
    )
  );
  return { calls, client };
};

describe('createAgenciesClient', () => {
  it('lists the agencies without scoping to the agency on screen', async () => {
    const { calls, client } = fakeAgencies();
    assert.deepEqual(await client.list(), agencies);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['http://api.test/api/agencies']
    );
  });

  it('reads the access to the agency it is asked about', async () => {
    const { calls, client } = fakeAgencies();
    assert.deepEqual(await client.access('a1'), access);
    assert.deepEqual(
      calls.map((c) => c.url),
      ['http://api.test/api/agencies/a1/access']
    );
  });

  it('drops permissions it does not know', async () => {
    const { client } = fakeAgencies(['claims:read', 'bogus:do', 'users:read']);
    assert.deepEqual((await client.access('a1')).permissions, ['claims:read', 'users:read']);
  });

  it('hands the abort signal to fetch', async () => {
    const { calls, client } = fakeAgencies();
    const controller = new AbortController();
    await client.list(controller.signal);
    await client.access('a1', controller.signal);
    assert.deepEqual(
      calls.map((c) => c.signal),
      [controller.signal, controller.signal]
    );
  });
});

describe('remembered agency', () => {
  it('finds no agency when none was remembered', () => {
    assert.equal(rememberedAgency(agencies), null);
  });

  it('finds the last agency remembered', () => {
    rememberAgency('a1');
    rememberAgency('a2');
    assert.equal(localStorage.getItem('ugula.agency'), 'a2');
    assert.equal(rememberedAgency(agencies), agencies[1]);
  });

  it('finds nothing when the remembered agency is no longer allowed', () => {
    rememberAgency('gone');
    assert.equal(rememberedAgency(agencies), null);
  });

  it('shrugs off storage that refuses to work', () => {
    const fail = () => {
      throw new Error('blocked');
    };
    stubStorage({ setItem: fail, getItem: fail });
    assert.doesNotThrow(() => rememberAgency('a1'));
    assert.equal(rememberedAgency(agencies), null);
  });
});

describe('useCan', () => {
  const Probe = ({ permission }: { permission: Permission }) =>
    createElement('output', null, String(useCan()(permission)));

  const can = (permission: Permission, provided: Access | null = access) => {
    const probe = createElement(Probe, { permission });
    render(provided ? createElement(AccessProvider, { access: provided, children: probe }) : probe);
    return screen.getByRole('status').textContent;
  };

  it('allows a permission the access grants', () => {
    assert.equal(can('claims:read'), 'true');
  });

  it('refuses a permission the access does not grant', () => {
    assert.equal(can('users:read'), 'false');
  });

  it('refuses everything without an access provider', () => {
    assert.equal(can('claims:read', null), 'false');
  });
});

describe('useAccess', () => {
  const Name = () => createElement('output', null, useAccess().agencyName);

  it('hands out the provided access', () => {
    render(createElement(AccessProvider, { access, children: createElement(Name) }));
    assert.equal(screen.getByRole('status').textContent, 'North EMS');
  });

  it('insists on an access provider', () => {
    assert.throws(() => render(createElement(Name)), /useAccess needs an AccessProvider/);
  });
});
