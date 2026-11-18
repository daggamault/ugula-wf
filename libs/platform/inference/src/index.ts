export type Fetch = typeof fetch;

export type Embedder = {
  embed: (texts: string[]) => Promise<number[][]>;
};

export const EMBED_BATCH_SIZE = 256;

const TIMEOUT_MS = 120_000;

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
