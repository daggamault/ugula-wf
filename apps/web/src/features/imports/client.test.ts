import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Api } from '../../shared/api.ts';
import { createImportsClient } from './client.ts';

const recordingApi = (reply: unknown) => {
  const calls: unknown[][] = [];
  const record =
    (method: string) =>
    async (...args: unknown[]) => {
      calls.push([method, ...args]);
      return reply;
    };
  const api = { get: record('get'), upload: record('upload') };
  return { client: createImportsClient(api as unknown as Api), calls };
};

describe('createImportsClient', () => {
  it('searches imports with the page query', async () => {
    const page = { items: [], total: 0, page: 1, pageSize: 25 };
    const { client, calls } = recordingApi(page);
    const signal = new AbortController().signal;
    assert.equal(await client.list('q=oct&page=1', signal), page);
    assert.deepEqual(calls, [['get', '/api/imports?q=oct&page=1', signal]]);
  });

  it('opens one import out of its envelope', async () => {
    const { client, calls } = recordingApi({ import: { id: 'i 1' } });
    assert.deepEqual(await client.find('i 1'), { id: 'i 1' });
    assert.deepEqual(calls, [['get', '/api/imports/i%201', undefined]]);
  });

  it('pages the PCRs of an import on the server', async () => {
    const page = { items: [], total: 0, page: 2, pageSize: 25 };
    const { client, calls } = recordingApi(page);
    const signal = new AbortController().signal;
    assert.equal(await client.reports('i 1', 'page=2', signal), page);
    assert.deepEqual(calls, [['get', '/api/imports/i%201/reports?page=2', signal]]);
  });

  it('uploads the file as multipart form data to the chosen agency', async () => {
    const result = { runId: 'r1' };
    const { client, calls } = recordingApi(result);
    const file = new File(['<x/>'], 'pcrs.xml');
    assert.equal(await client.upload(file, 'a-1'), result);
    assert.equal(calls.length, 1);
    const [method, path, form, agencyId] = calls[0] ?? [];
    assert.deepEqual([method, path, agencyId], ['upload', '/api/imports', 'a-1']);
    assert.ok(form instanceof FormData);
    assert.deepEqual([...form.keys()], ['file']);
    const sent = form.get('file');
    assert.ok(sent instanceof File);
    assert.deepEqual([sent.name, await sent.text()], ['pcrs.xml', '<x/>']);
  });
});
