import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createTasksClient, taskFilterOf } from './client.ts';

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
    await client.uploadFile('x', new File(['%PDF'], 'pcs.pdf'));
    assert.deepEqual(calls, [
      'GET /api/tasks/queues',
      'GET /api/tasks/x',
      'POST /api/tasks/next {"queue":"billing"}',
      'POST /api/tasks/next {"queue":null}',
      'POST /api/tasks/x/claim',
      'POST /api/tasks/x/release',
      'POST /api/tasks/x/complete {"outcome":"approve","values":{"note":"ok"}}',
      'GET /api/imports/reports/rep-1',
      'POST /api/tasks/x/files [object FormData]'
    ]);
  });
});

describe('tasks client errors', () => {
  it('encodes task ids and surfaces API errors', async () => {
    const urls: string[] = [];
    const client = createTasksClient(
      createApi('', async (url) => {
        urls.push(String(url));
        return new Response('{"error":"Task is already completed"}', { status: 409 });
      })
    );
    await assert.rejects(() => client.complete('a/b', 'approve', {}), /Task is already completed/);
    await assert.rejects(() => client.find('a b'), /Task is already completed/);
    assert.deepEqual(urls, ['/api/tasks/a%2Fb/complete', '/api/tasks/a%20b']);
  });
});

describe('tasks client list', () => {
  it('lists tasks with the page query and only the filters that narrow it', async () => {
    const urls: string[] = [];
    const client = createTasksClient(
      createApi('', async (url) => {
        urls.push(String(url));
        return new Response('{"items":[],"total":0,"page":1,"pageSize":25}', { status: 200 });
      })
    );
    assert.deepEqual(await client.list({ queue: null, assignee: 'all' }, 'page=1'), {
      items: [],
      total: 0,
      page: 1,
      pageSize: 25
    });
    await client.list({ queue: 'billing review', assignee: 'mine' }, 'q=doe&sort=due&dir=asc');
    assert.deepEqual(urls, [
      '/api/tasks?page=1',
      '/api/tasks?q=doe&sort=due&dir=asc&queue=billing+review&assignee=mine'
    ]);
  });
});

describe('taskFilterOf', () => {
  it('reads the queue and assignee, ignoring blanks and unknown assignees', () => {
    assert.deepEqual(taskFilterOf(new URLSearchParams()), { queue: null, assignee: 'all' });
    assert.deepEqual(
      taskFilterOf(new URLSearchParams('queue=billing-review&assignee=unassigned')),
      {
        queue: 'billing-review',
        assignee: 'unassigned'
      }
    );
    assert.deepEqual(taskFilterOf(new URLSearchParams('queue=&assignee=everyone')), {
      queue: null,
      assignee: 'all'
    });
  });
});
