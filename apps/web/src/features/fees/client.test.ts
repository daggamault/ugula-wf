import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createFeesClient } from './client.ts';

describe('createFeesClient', () => {
  it('searches and finds fees, lists directory payers, saves and deletes fees', async () => {
    const seen: string[] = [];
    const client = createFeesClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        const body =
          init.method === 'GET'
            ? String(url).endsWith('/payers/names')
              ? { payers: [{ id: 'p-m', name: 'Medicare' }] }
              : { items: [], fee: { id: 'f1' } }
            : init.method === 'PUT'
              ? { fee: { id: 'f1' } }
              : { status: 'deleted' };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    assert.deepEqual((await client.search('q=a04&page=1')).items, []);
    assert.deepEqual(await client.fee('f1'), { id: 'f1' });
    assert.deepEqual(await client.payers(), [{ id: 'p-m', name: 'Medicare' }]);
    assert.deepEqual(await client.save({ payerId: null, code: 'A0427', amountCents: 95000 }), {
      id: 'f1'
    });
    await client.remove('f1');
    assert.deepEqual(seen, [
      'GET http://api.test/api/fees?q=a04&page=1 ',
      'GET http://api.test/api/fees/f1 ',
      'GET http://api.test/api/payers/names ',
      'PUT http://api.test/api/fees {"payerId":null,"code":"A0427","amountCents":95000}',
      'DELETE http://api.test/api/fees/f1 '
    ]);
  });
});
