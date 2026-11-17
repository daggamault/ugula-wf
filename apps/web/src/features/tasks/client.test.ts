import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createTasksClient } from './client.ts';

type Call = [method: string, path: string, body?: unknown];

const fakeApi = (respond: (path: string) => unknown = () => ({})) => {
  const calls: Call[] = [];
  const answer = async (call: Call) => {
    calls.push(call);
    const reply = respond(call[1]);
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const api = {
    get: (path: string, signal?: AbortSignal) =>
      answer(signal ? ['GET', path, signal] : ['GET', path]),
    post: (path: string, body?: unknown) =>
      answer(body === undefined ? ['POST', path] : ['POST', path, body]),
    put: (path: string, body: unknown) => answer(['PUT', path, body]),
    remove: (path: string) => answer(['DELETE', path]),
    upload: (path: string, form: FormData) => answer(['UPLOAD', path, form]),
    href: (path: string) => path
  } as Api;
  return { api, calls };
};

const page = { items: [], total: 0, page: 1, pageSize: 25 };

describe('tasks client list', () => {
  it('lists tasks with the page, search and filter query', async () => {
    const { api, calls } = fakeApi(() => page);
    const signal = new AbortController().signal;
    const client = createTasksClient(api);
    assert.deepEqual(await client.list('q=doe&queue=billing-review&assignee=none', signal), page);
    assert.deepEqual(calls, [
      ['GET', '/api/tasks?q=doe&queue=billing-review&assignee=none', signal]
    ]);
  });
});

describe('tasks client', () => {
  it('unwraps the queues', async () => {
    const { api, calls } = fakeApi(() => ({ queues: ['q'] }));
    assert.deepEqual(await createTasksClient(api).queues(), ['q']);
    assert.deepEqual(calls, [['GET', '/api/tasks/queues']]);
  });

  it('finds a task by its encoded id', async () => {
    const { api, calls } = fakeApi(() => ({ task: { id: 'a b' } }));
    assert.deepEqual(await createTasksClient(api).find('a b'), { id: 'a b' });
    assert.deepEqual(calls, [['GET', '/api/tasks/a%20b']]);
  });

  it('takes the next task of a queue or of any queue', async () => {
    const { api, calls } = fakeApi((path) => ({ task: path ? { id: 'x' } : null }));
    const client = createTasksClient(api);
    assert.deepEqual(await client.next('billing'), { id: 'x' });
    await client.next(null);
    assert.deepEqual(calls, [
      ['POST', '/api/tasks/next', { queue: 'billing' }],
      ['POST', '/api/tasks/next', { queue: null }]
    ]);
  });

  it('says when no task is waiting', async () => {
    const { api } = fakeApi(() => ({ task: null }));
    assert.equal(await createTasksClient(api).next(null), null);
  });

  it('takes and gives back a task', async () => {
    const { api, calls } = fakeApi(() => ({ status: 'ok' }));
    const client = createTasksClient(api);
    assert.deepEqual(await client.assign('a/b'), { status: 'ok' });
    assert.deepEqual(await client.unassign('a/b'), { status: 'ok' });
    assert.deepEqual(calls, [
      ['POST', '/api/tasks/a%2Fb/claim'],
      ['POST', '/api/tasks/a%2Fb/release']
    ]);
  });

  it('completes a task with its outcome and values', async () => {
    const { api, calls } = fakeApi(() => ({ status: 'completed' }));
    assert.deepEqual(await createTasksClient(api).complete('a/b', 'approve', { note: 'ok' }), {
      status: 'completed'
    });
    assert.deepEqual(calls, [
      [
        'POST',
        '/api/tasks/a%2Fb/complete',
        { outcome: 'approve', values: { note: 'ok' }, note: '' }
      ]
    ]);
  });

  it('passes on the server error when a task cannot be completed', async () => {
    const refused = Object.assign(new Error('Task is already completed'), { status: 409 });
    const { api } = fakeApi(() => refused);
    await assert.rejects(createTasksClient(api).complete('x', 'approve', {}), refused);
  });

  it('finds the follow-up task of the same run', async () => {
    const { api, calls } = fakeApi(() => ({
      ...page,
      items: [
        { id: 't1', title: 'Done', subject: null },
        { id: 't2', title: 'Next', subject: 'PCR-1' }
      ]
    }));
    assert.deepEqual(await createTasksClient(api).followUp('run 1', 't1'), {
      id: 't2',
      title: 'Next',
      subject: 'PCR-1'
    });
    assert.deepEqual(calls, [['GET', '/api/tasks?runId=run%201']]);
  });

  it('has no follow-up when the run has only the finished task', async () => {
    const { api } = fakeApi(() => ({
      ...page,
      items: [{ id: 't1', title: 'Done', subject: null }]
    }));
    assert.equal(await createTasksClient(api).followUp('r1', 't1'), null);
  });

  it('uploads a task file as a form', async () => {
    const stored = { file: { key: 'k' }, name: 'pcs.pdf' };
    const { api, calls } = fakeApi(() => stored);
    assert.deepEqual(
      await createTasksClient(api).uploadFile('a/b', new File(['%PDF'], 'pcs.pdf')),
      stored
    );
    const [call] = calls;
    assert.equal(call?.[1], '/api/tasks/a%2Fb/files');
    const form = call?.[2];
    assert.ok(form instanceof FormData);
    assert.deepEqual([...form.keys()], ['file']);
    assert.equal((form.get('file') as File).name, 'pcs.pdf');
  });
});
