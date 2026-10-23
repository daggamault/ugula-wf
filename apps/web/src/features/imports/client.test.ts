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
});
