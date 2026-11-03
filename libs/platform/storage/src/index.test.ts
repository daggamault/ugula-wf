import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { describe, it } from 'node:test';
import { createBlobStore, createS3Storage, type ObjectStorage } from './index.ts';

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
    ensure: async () => undefined
  };
};

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
  });

  it('refuses references to other buckets', async () => {
    const blobs = createBlobStore(memory());
    await assert.rejects(() => blobs.getText({ bucket: 'other', key: 'k' }), /not in bucket ugula/);
  });
});

describe('createS3Storage', () => {
  it('builds an S3-backed object storage without connecting', () => {
    const storage = createS3Storage({
      endpoint: 'http://localhost:9000',
      region: 'us-east-1',
      bucket: 'ugula',
      accessKeyId: 'k',
      secretAccessKey: 's'
    });
    assert.equal(storage.bucket, 'ugula');
    assert.deepEqual(Object.keys(storage), ['bucket', 'get', 'put', 'ensure']);
  });

  it('reads objects and refuses ones larger than the limit', async () => {
    const server = createServer((req, res) => {
      const body = req.url?.includes('big') ? 'x'.repeat(10) : 'tiny';
      res.writeHead(200, { 'content-length': body.length, 'content-type': 'text/plain' });
      res.end(body);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    try {
      const storage = createS3Storage({
        endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        region: 'us-east-1',
        bucket: 'ugula',
        accessKeyId: 'k',
        secretAccessKey: 's',
        maxObjectBytes: 8
      });
      assert.equal(new TextDecoder().decode(await storage.get('small')), 'tiny');
      await assert.rejects(() => storage.get('big'), /Object big is 10 bytes, more than 8/);
    } finally {
      server.close();
    }
  });
});
