import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client
} from '@aws-sdk/client-s3';

export type BlobRef = {
  bucket: string;
  key: string;
  size: number;
  contentType: string;
};

export type BlobLocation = Pick<BlobRef, 'bucket' | 'key'>;

export const importsPrefix = (tenantId: string) => `imports/${tenantId}/`;

export type ObjectStorage = {
  bucket: string;
  get: (key: string) => Promise<Uint8Array>;
  put: (key: string, body: Uint8Array, contentType: string) => Promise<void>;
  ensure: () => Promise<void>;
};

export type S3Config = {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  maxObjectBytes?: number;
};

export const createS3Storage = ({
  endpoint,
  region,
  bucket,
  accessKeyId,
  secretAccessKey,
  maxObjectBytes = 128 * 1024 * 1024
}: S3Config): ObjectStorage => {
  const tooLarge = (key: string, size: number) => {
    if (size > maxObjectBytes) {
      throw new Error(`Object ${key} is ${size} bytes, more than ${maxObjectBytes}`);
    }
  };
  const client = new S3Client({
    endpoint,
    region,
    forcePathStyle: true,
    credentials: { accessKeyId, secretAccessKey }
  });
  return {
    bucket,
    get: async (key) => {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!out.Body) throw new Error(`Object ${key} has no body`);
      tooLarge(key, out.ContentLength ?? 0);
      const bytes = await out.Body.transformToByteArray();
      tooLarge(key, bytes.byteLength);
      return bytes;
    },
    put: async (key, body, contentType) => {
      await client.send(
        new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType })
      );
    },
    ensure: async () => {
      try {
        await client.send(new HeadBucketCommand({ Bucket: bucket }));
      } catch (err) {
        if (!(err instanceof Error) || err.name !== 'NotFound') throw err;
        await client.send(new CreateBucketCommand({ Bucket: bucket }));
      }
    }
  };
};

export const createBlobStore = (storage: ObjectStorage) => {
  const { bucket } = storage;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const check = (ref: BlobLocation) => {
    if (ref.bucket !== bucket) throw new Error(`Blob ${ref.key} is not in bucket ${bucket}`);
    return ref.key;
  };
  const putBytes = async (key: string, body: Uint8Array, contentType: string): Promise<BlobRef> => {
    await storage.put(key, body, contentType);
    return { bucket, key, size: body.byteLength, contentType };
  };
  const getText = async (ref: BlobLocation) => decoder.decode(await storage.get(check(ref)));
  return {
    putBytes,
    putJson: (key: string, value: unknown) =>
      putBytes(key, encoder.encode(JSON.stringify(value)), 'application/json'),
    getBytes: async (ref: BlobLocation) => storage.get(check(ref)),
    getText,
    getJson: async (ref: BlobLocation): Promise<unknown> => JSON.parse(await getText(ref)),
    ensureBucket: storage.ensure
  };
};

export type BlobStore = ReturnType<typeof createBlobStore>;
