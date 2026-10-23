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
        return new Response('{"profile":null,"payers":[]}', { status: 200 });
      })
    );
    assert.equal(await client.profile(), null);
    assert.deepEqual(await client.payers(), []);
    await client.savePayer({ name: 'Medicare', payerId: '00952', claimFiling: 'MB' });
    await client.removePayer('p1');
    await client.saveProfile({
      organizationName: 'Acme',
      npi: '1234567893',
      taxId: '123456789',
      addressLine: '1 Rd',
      city: 'X',
      state: 'IL',
      postalCode: '62704',
      phone: '2175550100',
      submitterId: null,
      receiverId: null,
      receiverName: null,
      production: false
    });
    assert.deepEqual(seen, [
      'GET http://api.test/api/billing-profile',
      'GET http://api.test/api/payers',
      'PUT http://api.test/api/payers',
      'DELETE http://api.test/api/payers/p1',
      'PUT http://api.test/api/billing-profile'
    ]);
  });
});
