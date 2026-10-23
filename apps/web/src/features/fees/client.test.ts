import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createFeesClient } from './client.ts';

describe('createFeesClient', () => {
  it('lists, saves and deletes fees', async () => {
    const seen: string[] = [];
    const client = createFeesClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        const body =
          init.method === 'GET'
            ? { fees: [] }
            : init.method === 'PUT'
              ? { fee: { id: 'f1' } }
              : { status: 'deleted' };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    assert.deepEqual(await client.list(), []);
    assert.deepEqual(await client.save({ payer: null, code: 'A0427', amountCents: 95000 }), {
      id: 'f1'
    });
    await client.remove('f1');
    assert.deepEqual(seen, [
      'GET http://api.test/api/fees ',
      'PUT http://api.test/api/fees {"payer":null,"code":"A0427","amountCents":95000}',
      'DELETE http://api.test/api/fees/f1 '
    ]);
  });
});
