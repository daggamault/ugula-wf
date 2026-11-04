import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import type { Permission } from '@ugula/access';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
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
});

describe('createAgenciesClient', () => {
  it('lists agencies unscoped and drops permissions it does not know', async () => {
    const urls: string[] = [];
    const client = createAgenciesClient(
      createApi(
        'http://api.test',
        async (url) => {
          urls.push(String(url));
          const body = String(url).endsWith('/access')
            ? { ...access, permissions: ['claims:read', 'bogus:do'] }
            : { items: agencies };
          return new Response(JSON.stringify(body), { status: 200 });
        },
        () => undefined,
        () => 'a9'
      )
    );
    assert.deepEqual(await client.list(), agencies);
    assert.deepEqual(await client.access('a1'), access);
    assert.deepEqual(urls, [
      'http://api.test/api/agencies',
      'http://api.test/api/agencies/a1/access'
    ]);
  });
});

describe('remembered agency', () => {
  it('stores the last agency and finds it among the ones still allowed', () => {
    const items = new Map<string, string>();
    stubStorage({
      setItem: (k, v) => void items.set(k, v),
      getItem: (k) => items.get(k) ?? null
    });
    assert.equal(rememberedAgency(agencies), null);
    rememberAgency('a2');
    assert.equal(rememberedAgency(agencies), agencies[1]);
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

describe('access context', () => {
  const Probe = ({ permission }: { permission: Permission }) => {
    const can = useCan();
    return createElement('p', null, String(can(permission)));
  };

  const Name = () => createElement('p', null, useAccess().agencyName);

  it('answers permission checks from the provided access', () => {
    const within = (permission: Permission) =>
      renderToStaticMarkup(
        createElement(AccessProvider, { access, children: createElement(Probe, { permission }) })
      );
    assert.equal(within('claims:read'), '<p>true</p>');
    assert.equal(within('users:read'), '<p>false</p>');
    assert.equal(
      renderToStaticMarkup(createElement(Probe, { permission: 'claims:read' })),
      '<p>false</p>'
    );
  });

  it('hands out the access and insists on a provider', () => {
    assert.equal(
      renderToStaticMarkup(
        createElement(AccessProvider, { access, children: createElement(Name) })
      ),
      '<p>North EMS</p>'
    );
    assert.throws(() => renderToStaticMarkup(createElement(Name)), /needs an AccessProvider/);
  });
});
