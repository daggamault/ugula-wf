import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Api, createApi } from '../../shared/api.ts';
import { createPayerFilesClient } from './client.ts';

describe('payer files client', () => {
  it('lists, finds, links and uploads payer files', async () => {
    const calls: unknown[][] = [];
    const api = {
      get: async (path: string) => {
        calls.push(['get', path]);
        return { items: [] };
      },
      upload: async (path: string, form: FormData) => {
        calls.push(['upload', path, (form.get('file') as File).name]);
        return { id: 'f1' };
      },
      href: (path: string) => `https://app${path}`
    } as unknown as Api;
    const client = createPayerFilesClient(api);
    await client.list('page=2');
    await client.find('a/b');
    await client.upload(new File(['ISA'], 'era.835'));
    assert.deepEqual(calls, [
      ['get', '/api/payer-files?page=2'],
      ['get', '/api/payer-files/a%2Fb'],
      ['upload', '/api/payer-files', 'era.835']
    ]);
    assert.equal(client.fileHref('f1'), 'https://app/api/payer-files/f1/file');
  });
});

describe('payer files client errors', () => {
  it('rejects uploads with the reason the server gives', async () => {
    const client = createPayerFilesClient(
      createApi('', async () => Response.json({ error: 'Not an X12 file' }, { status: 400 }))
    );
    await assert.rejects(client.upload(new File(['x'], 'a.txt')), {
      message: 'Not an X12 file',
      status: 400
    });
  });
});
