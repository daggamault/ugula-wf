export type Fetch = typeof fetch;

export type Embedder = {
  embed: (texts: string[]) => Promise<number[][]>;
};

export const EMBED_BATCH_SIZE = 256;

const TIMEOUT_MS = 120_000;

const isVector = (x: unknown): x is number[] =>
  Array.isArray(x) && x.length > 0 && x.every((n) => typeof n === 'number');

export type Wait = (ms: number) => Promise<void>;

const BUSY = new Set([429, 503]);

const RETRY_DELAYS_MS = [250, 1_000, 4_000];

const sleep: Wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const postJson = async (fetch: Fetch, wait: Wait, url: string, body: unknown) => {
  const send = () =>
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS)
    });
  let res = await send();
  for (const delay of RETRY_DELAYS_MS) {
    if (!BUSY.has(res.status)) break;
    await res.body?.cancel();
    await wait(delay);
    res = await send();
  }
  if (!res.ok) {
    throw new Error(`${url} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }
  return res.json() as Promise<unknown>;
};

export const createEmbedder = ({
  url,
  fetch,
  wait = sleep
}: {
  url: string;
  fetch: Fetch;
  wait?: Wait;
}): Embedder => ({
  embed: async (texts) => {
    const vectors: number[][] = [];
    for (let i = 0; i < texts.length; i += EMBED_BATCH_SIZE) {
      const batch = texts.slice(i, i + EMBED_BATCH_SIZE);
      const out = await postJson(fetch, wait, `${url}/embed`, {
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
