import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createSettingsClient } from './client.ts';

describe('createSettingsClient', () => {
  it('reads and saves the billing profile and payer directory', async () => {
    const seen: string[] = [];
    const client = createSettingsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)}`);
        return new Response('{"profile":null,"items":[],"payer":{"id":"p1"}}', { status: 200 });
      })
    );
    assert.equal(await client.profile(), null);
    assert.deepEqual((await client.searchPayers('q=blue&page=1')).items, []);
    assert.deepEqual(await client.payer('p1'), { id: 'p1' });
    await client.savePayer({
      name: 'Medicare',
      payerId: '00952',
      claimFiling: 'MB',
      filingLimitDays: null,
      correctionMethod: null,
      appealDays: null,
      planType: null
    });
    await client.removePayer('p1');
    await client.forgetAlias('p1', 'a1');
    await client.saveProfile({
      organizationName: 'Acme',
      npi: '1234567893',
      taxId: '123456789',
      addressLine: '1 Rd',
      city: 'X',
      state: 'IL',
      postalCode: '627041234',
      phone: '2175550100',
      submitterId: null,
      receiverId: null,
      receiverName: null,
      timeZone: 'America/Chicago',
      production: false
    });
    await client.connection();
    await client.removeConnection();
    assert.deepEqual(seen, [
      'GET http://api.test/api/billing-profile',
      'GET http://api.test/api/payers?q=blue&page=1',
      'GET http://api.test/api/payers/p1',
      'PUT http://api.test/api/payers',
      'DELETE http://api.test/api/payers/p1',
      'DELETE http://api.test/api/payers/p1/aliases/a1',
      'PUT http://api.test/api/billing-profile',
      'GET http://api.test/api/clearinghouse-connection',
      'DELETE http://api.test/api/clearinghouse-connection'
    ]);
  });
});

describe('settings client errors', () => {
  it('encodes ids into paths and surfaces API errors', async () => {
    const seen: string[] = [];
    const client = createSettingsClient(
      createApi('http://api.test', async (url) => {
        seen.push(String(url));
        return new Response('{"error":"Payer is billed on open claims"}', { status: 409 });
      })
    );
    await assert.rejects(() => client.removePayer('a/b'), /Payer is billed on open claims/);
    await assert.rejects(() => client.payer('a b'), /Payer is billed on open claims/);
    assert.deepEqual(seen, [
      'http://api.test/api/payers/a%2Fb',
      'http://api.test/api/payers/a%20b'
    ]);
  });
});
