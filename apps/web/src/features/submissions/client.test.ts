import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createSubmissionsClient } from './client.ts';

describe('createSubmissionsClient', () => {
  it('reads pending claims and batches, creates batches and records manual submissions', async () => {
    const seen: string[] = [];
    const client = createSubmissionsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        const body = String(url).endsWith('/pending')
          ? { issues: [], claims: [] }
          : String(url).endsWith('/manual')
            ? { payer: 'Medicare' }
            : init.method === 'POST'
              ? { batch: { id: 'b1' } }
              : { batches: [] };
        return new Response(JSON.stringify(body), { status: 200 });
      })
    );
    assert.deepEqual(await client.pending(), { issues: [], claims: [] });
    assert.deepEqual(await client.batches(), []);
    assert.deepEqual(await client.createBatch(['c1']), { id: 'b1' });
    await client.markSubmitted('c1');
    assert.equal(client.fileUrl('b1'), 'http://api.test/api/submissions/batches/b1/file');
    assert.deepEqual(seen, [
      'GET http://api.test/api/submissions/pending ',
      'GET http://api.test/api/submissions/batches?limit=50 ',
      'POST http://api.test/api/submissions/batches {"claimIds":["c1"]}',
      'POST http://api.test/api/submissions/manual {"claimId":"c1"}'
    ]);
  });
});
