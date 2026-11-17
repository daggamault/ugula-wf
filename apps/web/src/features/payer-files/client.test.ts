import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { createPayerFilesClient } from './client.ts';

type Call = { method: string | undefined; url: string; file?: string };

const recordingClient = (body: unknown, status = 200, agency: string | null = null) => {
  const calls: Call[] = [];
  const client = createPayerFilesClient(
    createApi(
      'http://api.test',
      async (url, init = {}) => {
        const file = init.body instanceof FormData ? init.body.get('file') : null;
        calls.push({
          method: init.method,
          url: String(url),
          ...(file instanceof File ? { file: file.name } : {})
        });
        return Response.json(body, { status });
      },
      () => undefined,
      () => agency
    )
  );
  return { client, calls };
};

describe('createPayerFilesClient', () => {
  it('lists payer files with the table query', async () => {
    const page = { items: [], total: 0, page: 2, pageSize: 25 };
    const { client, calls } = recordingClient(page);
    assert.deepEqual(await client.list('page=2&pageSize=25'), page);
    assert.deepEqual(calls, [
      { method: 'GET', url: 'http://api.test/api/payer-files?page=2&pageSize=25' }
    ]);
  });

  it('finds a payer file with its lines by encoded id', async () => {
    const found = { file: { id: 'a/b' }, items: [] };
    const { client, calls } = recordingClient(found);
    assert.deepEqual(await client.find('a/b'), found);
    assert.deepEqual(calls, [{ method: 'GET', url: 'http://api.test/api/payer-files/a%2Fb' }]);
  });

  it('links to the original file within the current agency', () => {
    const { client } = recordingClient({}, 200, 'a-1');
    assert.equal(client.fileHref('f 1'), 'http://api.test/api/agencies/a-1/payer-files/f%201/file');
  });

  it('uploads the file as a form into the agency it was dropped in', async () => {
    const { client, calls } = recordingClient({ runId: 'r1', kind: '835' }, 200, 'a-current');
    assert.deepEqual(await client.upload(new File(['ISA'], 'era.835'), 'a-1'), {
      runId: 'r1',
      kind: '835'
    });
    assert.deepEqual(calls, [
      { method: 'POST', url: 'http://api.test/api/agencies/a-1/payer-files', file: 'era.835' }
    ]);
  });

  it('uploads unscoped when no agency is given', async () => {
    const { client, calls } = recordingClient({ runId: 'r1', kind: '835' }, 200, 'a-current');
    await client.upload(new File(['ISA'], 'era.835'), null);
    assert.deepEqual(calls, [
      { method: 'POST', url: 'http://api.test/api/payer-files', file: 'era.835' }
    ]);
  });

  it('rejects uploads with the reason the server gives', async () => {
    const { client } = recordingClient({ error: 'Not an X12 file' }, 400);
    await assert.rejects(client.upload(new File(['x'], 'a.txt'), null), {
      message: 'Not an X12 file',
      status: 400
    });
  });
});
