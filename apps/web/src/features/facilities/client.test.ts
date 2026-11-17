import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createFacilitiesClient, type FacilityInput } from './client.ts';

const recordingApi = (reply: unknown) => {
  const calls: unknown[][] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return reply;
    };
  const api = {
    get: record('get'),
    post: record('post'),
    put: record('put'),
    remove: record('remove')
  } as unknown as Api;
  return { client: createFacilitiesClient(api), calls };
};

const input: FacilityInput = {
  name: 'General',
  addressLine: null,
  city: null,
  state: null,
  postalCode: null,
  phone: null,
  kind: 'hospital',
  hasContract: false,
  contractNote: null
};

describe('createFacilitiesClient', () => {
  it('searches facilities with the page query and passes the abort signal on', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recordingApi(page);
    const signal = new AbortController().signal;
    assert.equal(await client.search('q=gen&page=1', signal), page);
    assert.deepEqual(calls, [['get', '/api/facilities?q=gen&page=1', signal]]);
  });

  it('reads one facility out of its envelope', async () => {
    const { client, calls } = recordingApi({ facility: { id: 'f 1', name: 'General' } });
    assert.deepEqual(await client.facility('f 1'), { id: 'f 1', name: 'General' });
    assert.deepEqual(calls, [['get', '/api/facilities/f%201', undefined]]);
  });

  it('creates a facility when it has no id yet', async () => {
    const { client, calls } = recordingApi({ id: 'f1' });
    assert.deepEqual(await client.save(null, input), { id: 'f1' });
    assert.deepEqual(calls, [['post', '/api/facilities', input]]);
  });

  it('updates an existing facility in place', async () => {
    const { client, calls } = recordingApi({ id: 'f 1' });
    assert.deepEqual(await client.save('f 1', input), { id: 'f 1' });
    assert.deepEqual(calls, [['put', '/api/facilities/f%201', input]]);
  });

  it('removes a facility by id', async () => {
    const { client, calls } = recordingApi({ id: 'f 1' });
    assert.deepEqual(await client.remove('f 1'), { id: 'f 1' });
    assert.deepEqual(calls, [['remove', '/api/facilities/f%201']]);
  });

  it('searches the CMS hospital list by name', async () => {
    const hospitals = [{ ccn: '010001', name: 'Southeast Health' }];
    const { client, calls } = recordingApi({ hospitals });
    const signal = new AbortController().signal;
    assert.equal(await client.hospitals('southeast & co', signal), hospitals);
    assert.deepEqual(calls, [['get', '/api/facilities/hospitals?q=southeast+%26+co', signal]]);
  });
});
