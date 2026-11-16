import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createSettingsClient } from './client.ts';

describe('createSettingsClient', () => {
  it('reads and saves the billing profile and clearinghouse connection', async () => {
    const seen: string[] = [];
    const client = createSettingsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)}`);
        return new Response('{"profile":null}', { status: 200 });
      })
    );
    assert.equal(await client.profile(), null);
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
      isProduction: false
    });
    await client.connection();
    await client.removeConnection();
    assert.deepEqual(seen, [
      'GET http://api.test/api/billing-profile',
      'PUT http://api.test/api/billing-profile',
      'GET http://api.test/api/clearinghouse-connection',
      'DELETE http://api.test/api/clearinghouse-connection'
    ]);
  });
});
