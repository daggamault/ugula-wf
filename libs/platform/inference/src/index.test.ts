import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createEmbedder, EMBED_BATCH_SIZE, type Fetch } from './index.ts';

type Call = { url: string; body: Record<string, unknown> };

const fakeFetch = (respond: (body: Record<string, unknown>) => Response) => {
  const calls: Call[] = [];
  const fetch: Fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    calls.push({ url: String(input), body });
    return respond(body);
  };
  return { fetch, calls };
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

const _answer = (content: string, finish = 'stop') =>
  json({ choices: [{ message: { content }, finish_reason: finish }] });

describe('createEmbedder', () => {
  it('embeds in batches the service accepts, in order', async () => {
    const { fetch, calls } = fakeFetch((b) => json((b.inputs as string[]).map((t) => [t.length])));
    const texts = Array.from({ length: EMBED_BATCH_SIZE + 1 }, (_, i) => 'x'.repeat(i + 1));
    const vectors = await createEmbedder({ url: 'http://tei', fetch }).embed(texts);
    assert.deepEqual(
      vectors,
      texts.map((t) => [t.length])
    );
    assert.deepEqual(
      calls.map((c) => [
        c.url,
        (c.body.inputs as string[]).length,
        c.body.normalize,
        c.body.truncate
      ]),
      [
        ['http://tei/embed', EMBED_BATCH_SIZE, true, true],
        ['http://tei/embed', 1, true, true]
      ]
    );
  });

  it('skips the call for no texts and rejects malformed or failed answers', async () => {
    const empty = fakeFetch(() => json([]));
    assert.deepEqual(await createEmbedder({ url: 'u', fetch: empty.fetch }).embed([]), []);
    assert.equal(empty.calls.length, 0);
    for (const out of [[], [[]], [['1']], [[1], [2]], { vectors: [[1]] }]) {
      await assert.rejects(
        createEmbedder({ url: 'u', fetch: fakeFetch(() => json(out)).fetch }).embed(['a']),
        /malformed vectors/
      );
    }
    const down = fakeFetch(() => new Response('overloaded', { status: 503 }));
    await assert.rejects(
      createEmbedder({ url: 'u', fetch: down.fetch }).embed(['a']),
      /u\/embed answered 503: overloaded/
    );
  });
});

const _direct = <T>(task: () => Promise<T>) => task();
