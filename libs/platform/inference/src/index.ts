import {
  createRedisLeases,
  createSharedLimiter,
  type Limiter,
  type ScriptRunner
} from './limiter.ts';

export { busyRetryAfter, type Limiter, type ScriptRunner } from './limiter.ts';

export type Fetch = typeof fetch;

export type Embedder = {
  embed: (texts: string[]) => Promise<number[][]>;
};

type JsonSchema = { [key: string]: unknown };

export type CompletionRequest = {
  system: string;
  user: string;
  schema: JsonSchema;
  maxTokens: number;
};

export type Completer = {
  complete: (request: CompletionRequest, signal?: AbortSignal) => Promise<unknown>;
};

export const EMBED_BATCH_SIZE = 256;

const TIMEOUT_MS = 120_000;

const COMPLETION_LEASES_KEY = 'ugula:completions:leases';

const LEASE_MS = TIMEOUT_MS + 30_000;

export const createCompletionLimiter = (
  redis: ScriptRunner,
  limit: number,
  onReleaseError?: (err: unknown) => void
): Limiter =>
  createSharedLimiter(
    createRedisLeases(redis, { key: COMPLETION_LEASES_KEY, limit, ttlMs: LEASE_MS }),
    onReleaseError ? { onReleaseError } : {}
  );

const isRecord = (x: unknown): x is Record<string, unknown> =>
  x !== null && typeof x === 'object' && !Array.isArray(x);

const isVector = (x: unknown): x is number[] =>
  Array.isArray(x) && x.length > 0 && x.every((n) => typeof n === 'number');

const postJson = async (fetch: Fetch, url: string, body: unknown, signal?: AbortSignal) => {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout
  });
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<unknown>;
};

export const createEmbedder = ({ url, fetch }: { url: string; fetch: Fetch }): Embedder => ({
  embed: async (texts) => {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const out = await postJson(fetch, `${url}/embed`, {
        inputs: batch,
        normalize: true,
        truncate: true
      });
      if (!Array.isArray(out) || out.length !== batch.length || !out.every(isVector)) {
        throw new Error('The embeddings service returned malformed vectors');
      }
      vectors.push(...out);
    }
    return vectors;
  }
});

export const createCompleter = ({
  url,
  model,
  fetch,
  limit
}: {
  url: string;
  model: string;
  fetch: Fetch;
  limit: Limiter;
}): Completer => {
  return {
    complete: async ({ system, user, schema, maxTokens }, signal) => {
      signal?.throwIfAborted();
      const out = await limit(() =>
        postJson(
          fetch,
          `${url}/v1/chat/completions`,
          {
            model,
            temperature: 0,
            max_tokens: maxTokens,
            response_format: {
              type: 'json_schema',
              json_schema: { name: 'result', strict: true, schema }
            },
            messages: [
              { role: 'system', content: system },
              { role: 'user', content: user }
            ]
          },
          signal
        )
      );
      const [choice] = isRecord(out) && Array.isArray(out.choices) ? out.choices : [];
      const content = isRecord(choice) && isRecord(choice.message) ? choice.message.content : null;
      if (isRecord(choice) && choice.finish_reason === 'length') {
        throw new Error(`The completion ran past ${maxTokens} tokens`);
      }
      if (typeof content !== 'string')
        throw new Error('The completions service returned no answer');
      return JSON.parse(content) as unknown;
    }
  };
};
