import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createPayersClient } from './client.ts';

describe('createPayersClient', () => {
  it('searches, reads, saves and removes payers and their names', async () => {
    const seen: string[] = [];
    const client = createPayersClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)}`);
        return new Response('{"items":[],"payer":{"id":"p1"}}', { status: 200 });
      })
    );
    assert.deepEqual((await client.search('q=blue&page=1')).items, []);
    assert.deepEqual(await client.payer('p1'), { id: 'p1' });
    await client.save({
      name: 'Medicare',
      payerCode: '00952',
      claimFiling: 'MB',
      filingLimitDays: null,
      correctionMethod: null,
      appealDays: null,
      planType: null
    });
    await client.remove('p1');
    await client.forgetAlias('p1', 'a1');
    assert.deepEqual(seen, [
      'GET http://api.test/api/payers?q=blue&page=1',
      'GET http://api.test/api/payers/p1',
      'PUT http://api.test/api/payers',
      'DELETE http://api.test/api/payers/p1',
      'DELETE http://api.test/api/payers/p1/aliases/a1'
    ]);
  });

  it('encodes ids into paths and surfaces API errors', async () => {
    const seen: string[] = [];
    const client = createPayersClient(
      createApi('http://api.test', async (url) => {
        seen.push(String(url));
        return new Response('{"error":"Payer is billed on open claims"}', { status: 409 });
      })
    );
    await assert.rejects(() => client.remove('a/b'), /Payer is billed on open claims/);
    await assert.rejects(() => client.payer('a b'), /Payer is billed on open claims/);
    assert.deepEqual(seen, [
      'http://api.test/api/payers/a%2Fb',
      'http://api.test/api/payers/a%20b'
    ]);
  });
});
