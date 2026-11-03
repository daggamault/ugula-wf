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
    assert.deepEqual(await client.find('x'), { id: 'x' });
    assert.deepEqual(await client.next('billing'), { id: 'x' });
    await client.next(null);
    await client.assign('x');
    await client.unassign('x');
    await client.complete('x', 'approve', { note: 'ok' });
    await client.report('rep-1');
    assert.deepEqual(calls, [
      'GET /api/tasks/queues',
      'GET /api/tasks/x',
      'POST /api/tasks/next {"queue":"billing"}',
      'POST /api/tasks/next {"queue":null}',
      'POST /api/tasks/x/claim',
      'POST /api/tasks/x/release',
      'POST /api/tasks/x/complete {"outcome":"approve","values":{"note":"ok"}}',
      'GET /api/imports/reports/rep-1'
    ]);
  });
});
