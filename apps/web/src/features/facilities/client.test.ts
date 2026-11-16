import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createFacilitiesClient } from './client.ts';

const facility = {
  name: 'General',
  addressLine: null,
  city: null,
  state: null,
  postalCode: null,
  phone: null,
  kind: 'hospital',
  hasContract: false,
  contractNote: null
} as const;

describe('createFacilitiesClient', () => {
  it('searches, reads, creates, updates and removes facilities', async () => {
    const seen: string[] = [];
    const client = createFacilitiesClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)}`);
        return new Response('{"items":[],"facility":{"id":"f1"},"id":"f1"}', { status: 200 });
      })
    );
    assert.deepEqual((await client.search('q=gen&page=1')).items, []);
    assert.deepEqual(await client.facility('f1'), { id: 'f1' });
    await client.save(null, facility);
    await client.save('f1', facility);
    await client.remove('f1');
    assert.deepEqual(seen, [
      'GET http://api.test/api/facilities?q=gen&page=1',
      'GET http://api.test/api/facilities/f1',
      'POST http://api.test/api/facilities',
      'PUT http://api.test/api/facilities/f1',
      'DELETE http://api.test/api/facilities/f1'
    ]);
  });

  it('searches the CMS hospital list by name', async () => {
    const seen: string[] = [];
    const client = createFacilitiesClient(
      createApi('http://api.test', async (url) => {
        seen.push(String(url));
        return new Response('{"hospitals":[{"ccn":"010001"}]}', { status: 200 });
      })
    );
    assert.deepEqual(await client.hospitals('southeast health'), [{ ccn: '010001' }]);
    assert.deepEqual(seen, ['http://api.test/api/facilities/hospitals?q=southeast+health']);
  });
});
