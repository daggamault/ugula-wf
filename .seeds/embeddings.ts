import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMBEDDING_DIMENSIONS } from '@ugula/db';
import { EMBED_BATCH_SIZE, type Embedder } from '@ugula/inference';

type Embed = Embedder['embed'];

const HASH_BYTES = 32;

const RECORD_BYTES = HASH_BYTES + EMBEDDING_DIMENSIONS * 4;

const CONCURRENCY = 1;

const hashOf = (text: string) => createHash('sha256').update(text).digest();

const readCache = async (file: string) => {
  const vectors = new Map<string, number[]>();
  const data = await readFile(file).catch((e: NodeJS.ErrnoException) => {
    if (e.code === 'ENOENT') return Buffer.alloc(0);
    throw e;
  });
  for (let at = 0; at + RECORD_BYTES <= data.length; at += RECORD_BYTES) {
    const floats = new Float32Array(EMBEDDING_DIMENSIONS);
    Buffer.from(floats.buffer).set(data.subarray(at + HASH_BYTES, at + RECORD_BYTES));
    vectors.set(data.subarray(at, at + HASH_BYTES).toString('hex'), [...floats]);
  }
  return vectors;
};

const recordOf = (text: string, vector: readonly number[]) => {
  if (vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(`Expected ${EMBEDDING_DIMENSIONS} dimensions, got ${vector.length}`);
  }
  return Buffer.concat([hashOf(text), Buffer.from(Float32Array.from(vector).buffer)]);
};

const chunksOf = <T>(items: readonly T[], size: number) =>
  Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
    items.slice(i * size, (i + 1) * size)
  );

export const cacheFileOf = (root: URL, model: string) =>
  fileURLToPath(new URL(`embeddings/${model.replace(/[^\w.@-]+/g, '_')}.bin`, root));

export const cachedEmbed = async (embed: Embed, file: string): Promise<Embed> => {
  const known = await readCache(file);
  await mkdir(dirname(file), { recursive: true });
  return async (texts) => {
    const missing = [...new Set(texts.filter((t) => !known.has(hashOf(t).toString('hex'))))];
    const batches = chunksOf(missing, EMBED_BATCH_SIZE);
    for (const group of chunksOf(batches, CONCURRENCY)) {
      const done = await Promise.all(
        group.map(async (batch) => [batch, await embed(batch)] as const)
      );
      for (const [batch, vectors] of done) {
        await appendFile(file, Buffer.concat(batch.map((t, i) => recordOf(t, vectors[i] ?? []))));
        for (const [i, t] of batch.entries())
          known.set(hashOf(t).toString('hex'), vectors[i] ?? []);
      }
    }
    return texts.map((t) => known.get(hashOf(t).toString('hex')) ?? []);
  };
};

export const embeddingModelOf = async (url: string, fetch: typeof globalThis.fetch) => {
  const res = await fetch(`${url}/info`);
  if (!res.ok) throw new Error(`${url}/info answered ${res.status}`);
  const info = (await res.json()) as { model_id?: unknown; model_sha?: unknown };
  if (typeof info.model_id !== 'string') throw new Error('The embeddings service names no model');
  return typeof info.model_sha === 'string' ? `${info.model_id}@${info.model_sha}` : info.model_id;
};
