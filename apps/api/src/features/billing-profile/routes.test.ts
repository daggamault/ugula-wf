import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createBillingProfileRoutes } from './routes.ts';
import type { BillingProfileService } from './service.ts';

const body = {
  organizationName: 'Acme EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '100 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postalCode: '627041234',
  phone: '2175550100',
  timeZone: 'America/Chicago',
  submitterId: 'SUB01',
  receiverId: 'RCV01',
  receiverName: 'Demo Clearinghouse',
  isProduction: false
};

const setup = (overrides: Partial<Record<'find' | 'save', () => unknown>> = {}) => {
  const calls: unknown[][] = [];
  const service = {
    find: async (...args: unknown[]) => {
      calls.push(['find', ...args]);
      return overrides.find?.() ?? ok({ profile: null });
    },
    save: async (...args: unknown[]) => {
      calls.push(['save', ...args]);
      return overrides.save?.() ?? ok({ profile: body });
    }
  } as unknown as BillingProfileService;
  return { calls, request: withSession(createBillingProfileRoutes(service)) };
};

const put = (json: unknown) => ({ method: 'PUT', body: JSON.stringify(json) });

describe('billing profile routes', () => {
  it('reads the session agency profile', async () => {
    const { calls, request } = setup();
    const res = await request('/');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { profile: null });
    assert.deepEqual(calls, [['find', 't-1']]);
  });

  it('saves the session agency profile', async () => {
    const { calls, request } = setup();
    const res = await request('/', put(body));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { profile: body });
    assert.deepEqual(calls, [['save', 't-1', body]]);
  });

  it('rejects an invalid profile with its issues before saving', async () => {
    const { calls, request } = setup();
    const res = await request('/', put({ ...body, npi: '1' }));
    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), {
      error: 'npi: An NPI has 10 digits',
      issues: ['npi: An NPI has 10 digits', 'npi: This NPI fails its check digit']
    });
    assert.deepEqual(calls, []);
  });

  it('maps a submitter ID taken by another agency to 409', async () => {
    const { request } = setup({
      save: () => fail('conflict', 'Another agency already uses submitter ID SUB01')
    });
    const res = await request('/', put(body));
    assert.equal(res.status, 409);
    assert.deepEqual(await res.json(), {
      error: 'Another agency already uses submitter ID SUB01'
    });
  });
});
