import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createBlobStore, createS3Storage, importsPrefix, type ObjectStorage } from './index.ts';

const memory = (): ObjectStorage & { objects: Map<string, Uint8Array> } => {
  const objects = new Map<string, Uint8Array>();
  return {
    bucket: 'ugula',
    objects,
    get: async (key) => {
      const body = objects.get(key);
      if (!body) throw new Error(`missing ${key}`);
      return body;
    },
    put: async (key, body) => void objects.set(key, body),
    remove: async (key) => void objects.delete(key),
    ensure: async () => undefined
  };
};

describe('importsPrefix', () => {
  it('scopes imports to their agency', () => {
    assert.equal(importsPrefix('t-1'), 'imports/t-1/');
  });
});

describe('createBlobStore', () => {
  it('stores bytes and JSON and hands back references', async () => {
    const storage = memory();
    const blobs = createBlobStore(storage);
    const ref = await blobs.putJson('a/b.json', { pcr: 1 });
    assert.deepEqual(ref, {
      bucket: 'ugula',
      key: 'a/b.json',
      size: 9,
      contentType: 'application/json'
    });
    assert.deepEqual(await blobs.getJson(ref), { pcr: 1 });
    const xml = await blobs.putBytes('a.xml', new TextEncoder().encode('<x/>'), 'application/xml');
    assert.equal(await blobs.getText(xml), '<x/>');
    assert.equal(new TextDecoder().decode(await blobs.getBytes(xml)), '<x/>');
    await blobs.remove(xml);
    await assert.rejects(() => blobs.getBytes(xml), /missing a.xml/);
    await assert.rejects(() => blobs.remove({ bucket: 'other', key: 'a.xml' }), /not in bucket/);
  });

  it('refuses references to other buckets', async () => {
    const blobs = createBlobStore(memory());
    await assert.rejects(() => blobs.getText({ bucket: 'other', key: 'k' }), /not in bucket ugula/);
    await assert.rejects(
      () => blobs.getBytes({ bucket: 'other', key: 'k' }),
      /not in bucket ugula/
    );
    await assert.rejects(() => blobs.getJson({ bucket: 'other', key: 'k' }), /not in bucket ugula/);
  });
});

type Seen = { method: string; url: string; type: string | undefined; body: string };

const withS3 = async (
  respond: (req: Seen) => { status: number; body?: string },
  run: (storage: ObjectStorage, seen: Seen[]) => Promise<void>
) => {
  const seen: Seen[] = [];
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const entry = {
      method: req.method ?? '',
      url: req.url ?? '',
      type: req.headers['content-type'],
      body: Buffer.concat(chunks).toString()
    };
    seen.push(entry);
    const { status, body = '' } = respond(entry);
    res.writeHead(status, {
      'content-length': Buffer.byteLength(body),
      'content-type': 'text/plain'
    });
    res.end(entry.method === 'HEAD' ? undefined : body);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    await run(
      createS3Storage({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        region: 'us-east-1',
        bucket: 'ugula',
        accessKeyId: 'k',
        secretAccessKey: 's',
        maxObjectBytes: 8
      }),
      seen
    );
  } finally {
    server.close();
  }
};

describe('createS3Storage', () => {
  it('reads objects and refuses ones larger than the limit', async () => {
    await withS3(
      ({ url }) => ({ status: 200, body: url.includes('big') ? 'x'.repeat(10) : 'tiny' }),
      async (storage) => {
        assert.equal(new TextDecoder().decode(await storage.get('small')), 'tiny');
        await assert.rejects(() => storage.get('big'), /Object big is 10 bytes, more than 8/);
      }
    );
  });

  it('writes objects by path into its bucket with their content type', async () => {
    await withS3(
      () => ({ status: 200 }),
      async (storage, seen) => {
        await storage.put('a/b.json', new TextEncoder().encode('{}'), 'application/json');
        assert.deepEqual(
          seen.map(({ method, url, type, body }) => [method, url.split('?')[0], type, body]),
          [['PUT', '/ugula/a/b.json', 'application/json', '{}']]
        );
        await storage.remove('a/b.json');
        assert.deepEqual(
          seen.slice(1).map(({ method, url }) => [method, url.split('?')[0]]),
          [['DELETE', '/ugula/a/b.json']]
        );
      }
    );
  });

  it('creates the bucket only when it is missing', async () => {
    const calls = async (head: number) => {
      const out: string[] = [];
      await withS3(
        ({ method }) => ({ status: method === 'HEAD' ? head : 200 }),
        async (storage, seen) => {
          const failed = await storage.ensure().then(
            () => [],
            () => ['failed']
          );
          out.push(...seen.map((r) => `${r.method} ${r.url.split('?')[0]}`), ...failed);
        }
      );
      return out;
    };
    assert.deepEqual(await calls(200), ['HEAD /ugula/']);
    assert.deepEqual(await calls(404), ['HEAD /ugula/', 'PUT /ugula/']);
    assert.deepEqual(await calls(403), ['HEAD /ugula/', 'failed']);
  });
});
