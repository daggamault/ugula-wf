import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createTasksClient } from './client.ts';

describe('createTasksClient', () => {
  it('calls the task endpoints and unwraps payloads', async () => {
    const calls: string[] = [];
    const client = createTasksClient(
      createApi('', async (url, init = {}) => {
        calls.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`.trim());
        return new Response(JSON.stringify({ queues: ['q'], tasks: ['t'], task: { id: 'x' } }), {
          status: 200
        });
      })
    );
    assert.deepEqual(await client.queues(), ['q']);
    assert.deepEqual(await client.mine(), ['t']);
    assert.deepEqual(await client.find('x'), { id: 'x' });
    assert.deepEqual(await client.next('billing'), { id: 'x' });
    await client.claim('x');
    await client.release('x');
    await client.complete('x', 'approve', { note: 'ok' });
    assert.deepEqual(calls, [
      'GET /api/tasks/queues',
      'GET /api/tasks?mine=true',
      'GET /api/tasks/x',
      'POST /api/tasks/next {"queue":"billing"}',
      'POST /api/tasks/x/claim',
      'POST /api/tasks/x/release',
      'POST /api/tasks/x/complete {"outcome":"approve","values":{"note":"ok"}}'
    ]);
  });
});
