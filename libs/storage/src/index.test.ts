import assert from 'node:assert/strict';
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
});
