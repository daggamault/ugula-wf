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
    await client.mine('page=1');
    await client.open('billing review', 'page=2&sort=task');
    await client.open(null, 'page=1');
    assert.deepEqual(await client.find('x'), { id: 'x' });
    assert.deepEqual(await client.next('billing'), { id: 'x' });
    await client.claim('x');
    await client.release('x');
    await client.complete('x', 'approve', { note: 'ok' });
    await client.report('rep-1');
    assert.deepEqual(calls, [
      'GET /api/tasks/queues',
      'GET /api/tasks?mine=true&page=1',
      'GET /api/tasks?queue=billing%20review&page=2&sort=task',
      'GET /api/tasks?page=1',
      'GET /api/tasks/x',
      'POST /api/tasks/next {"queue":"billing"}',
      'POST /api/tasks/x/claim',
      'POST /api/tasks/x/release',
      'POST /api/tasks/x/complete {"outcome":"approve","values":{"note":"ok"}}',
      'GET /api/imports/reports/rep-1'
    ]);
  });
});
