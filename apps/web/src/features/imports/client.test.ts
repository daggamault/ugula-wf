import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createImportsClient } from './client.ts';

describe('createImportsClient', () => {
  it('posts the file as multipart form data', async () => {
    const seen: { url: string; file: FormDataEntryValue | null }[] = [];
    const client = createImportsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push({ url: String(url), file: (init.body as FormData).get('file') });
        return new Response('{"runId":"r1"}', { status: 201 });
      })
    );
    const file = new File(['<x/>'], 'pcrs.xml');
    assert.deepEqual(await client.upload(file), { runId: 'r1' });
    assert.equal(seen[0]?.url, 'http://api.test/api/imports');
    assert.ok(seen[0]?.file instanceof File && seen[0].file.name === 'pcrs.xml');
  });

  it('searches imports, opens one and pages its PCRs on the server', async () => {
    const seen: string[] = [];
    const client = createImportsClient(
      createApi('', async (url) => {
        seen.push(String(url));
        return new Response('{"import":{"id":"i 1"},"items":[]}', { status: 200 });
      })
    );
    await client.list('q=oct&page=1');
    assert.deepEqual(await client.find('i 1'), { id: 'i 1' });
    await client.reports('i 1', 'page=2');
    assert.deepEqual(seen, [
      '/api/imports?q=oct&page=1',
      '/api/imports/i%201',
      '/api/imports/i%201/reports?page=2'
    ]);
  });
});
