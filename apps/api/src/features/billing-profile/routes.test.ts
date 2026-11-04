import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createBillingProfileRoutes } from './routes.ts';
import type { BillingProfileService } from './service.ts';

const calls: unknown[][] = [];

const service = {
  find: async (...args: unknown[]) => {
    calls.push(['find', ...args]);
    return ok({ profile: null });
  },
  save: async (...args: unknown[]) => {
    calls.push(['save', ...args]);
    return ok({ profile: {} });
  }
} as unknown as BillingProfileService;

const request = withSession(createBillingProfileRoutes(service));

describe('billing profile routes', () => {
  it('reads and saves the session agency profile, rejecting invalid ones', async () => {
    assert.equal((await request('/')).status, 200);
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
      production: false
    };
    assert.equal((await request('/', { method: 'PUT', body: JSON.stringify(body) })).status, 200);
    const bad = await request('/', { method: 'PUT', body: JSON.stringify({ ...body, npi: '1' }) });
    assert.equal(bad.status, 400);
    assert.deepEqual(calls, [
      ['find', 't-1'],
      ['save', 't-1', body]
    ]);
  });
});
