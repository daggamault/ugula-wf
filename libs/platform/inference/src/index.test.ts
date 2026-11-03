import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  createCompleter,
  createCompletionLimiter,
  createEmbedder,
  EMBED_BATCH_SIZE,
  type Fetch
} from './index.ts';

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

const answer = (content: string, finish = 'stop') =>
  json({ choices: [{ message: { content }, finish_reason: finish }] });

describe('createEmbedder', () => {
  it('embeds in batches the service accepts, in order', async () => {
    const { fetch, calls } = fakeFetch((b) => json((b.inputs as string[]).map((t) => [t.length])));
    const texts = Array.from({ length: EMBED_BATCH_SIZE + 1 }, (_, i) => 'x'.repeat(i + 1));
    const vectors = await createEmbedder({ url: 'http://tei', fetch }).embed(texts);
    assert.equal(vectors.length, texts.length);
    assert.deepEqual(vectors.at(-1), [EMBED_BATCH_SIZE + 1]);
    assert.deepEqual(
      calls.map((c) => [c.url, (c.body.inputs as string[]).length, c.body.normalize]),
      [
        ['http://tei/embed', EMBED_BATCH_SIZE, true],
        ['http://tei/embed', 1, true]
      ]
    );
  });

  it('skips the call for no texts and rejects malformed or failed answers', async () => {
    const empty = fakeFetch(() => json([]));
    assert.deepEqual(await createEmbedder({ url: 'u', fetch: empty.fetch }).embed([]), []);
    assert.equal(empty.calls.length, 0);
    const short = fakeFetch(() => json([]));
    await assert.rejects(
      createEmbedder({ url: 'u', fetch: short.fetch }).embed(['a']),
      /malformed vectors/
    );
    const down = fakeFetch(() => new Response('overloaded', { status: 503 }));
    await assert.rejects(
      createEmbedder({ url: 'u', fetch: down.fetch }).embed(['a']),
      /u\/embed answered 503: overloaded/
    );
  });
});

const direct = <T>(task: () => Promise<T>) => task();

describe('createCompleter', () => {
  const request = {
    system: 'Extract.',
    user: 'Narrative',
    schema: { type: 'object' },
    maxTokens: 50
  };

  it('asks for deterministic output constrained to the schema and parses it', async () => {
    const { fetch, calls } = fakeFetch(() => answer('{"ok":true}'));
    const completer = createCompleter({ url: 'http://llm', model: 'm', fetch, limit: direct });
    assert.deepEqual(await completer.complete(request), { ok: true });
    assert.equal(calls[0]?.url, 'http://llm/v1/chat/completions');
    assert.deepEqual(calls[0]?.body, {
      model: 'm',
      temperature: 0,
      max_tokens: 50,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'result', strict: true, schema: { type: 'object' } }
      },
      messages: [
        { role: 'system', content: 'Extract.' },
        { role: 'user', content: 'Narrative' }
      ]
    });
  });

  it('passes the caller abort signal to the request', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const fetch: Fetch = async (_, init) => {
      seen.push(init?.signal);
      return answer('{"ok":true}');
    };
    const completer = createCompleter({ url: 'u', model: 'm', fetch, limit: direct });
    const controller = new AbortController();
    await completer.complete(request, controller.signal);
    controller.abort();
    assert.equal(seen[0]?.aborted, true);
    await assert.rejects(completer.complete(request, controller.signal), /abort/i);
    assert.equal(seen.length, 1);
  });

  it('rejects truncated, empty and failed completions', async () => {
    const run = (res: () => Response) =>
      createCompleter({
        url: 'u',
        model: 'm',
        fetch: fakeFetch(res).fetch,
        limit: direct
      }).complete(request);
    await assert.rejects(
      run(() => answer('{"ok":', 'length')),
      /ran past 50 tokens/
    );
    await assert.rejects(
      run(() => json({ choices: [] })),
      /returned no answer/
    );
    await assert.rejects(
      run(() => json({ error: 'x' }, 500)),
      /answered 500/
    );
  });
});

describe('createCompletionLimiter', () => {
  it('leases completion slots cluster-wide for longer than a completion may take', async () => {
    const calls: unknown[][] = [];
    const limit = createCompletionLimiter(
      {
        eval: async (_, __, ...args) => {
          calls.push(args);
          return 1;
        }
      },
      3
    );
    assert.equal(await limit(async () => 'done'), 'done');
    const [acquire, release] = calls;
    assert.equal(acquire?.[0], 'ugula:completions:leases');
    assert.equal(acquire?.[2], 3);
    assert.ok(Number(acquire?.[3]) > 120_000);
    assert.deepEqual(release, [acquire?.[0], acquire?.[1]]);
  });

  it('reports lease release failures without failing the completion', async () => {
    const errors: unknown[] = [];
    const limit = createCompletionLimiter(
      {
        eval: async (script) => {
          if (!script.includes('ZADD')) throw new Error('redis down');
          return 1;
        }
      },
      1,
      (err) => errors.push(err)
    );
    assert.equal(await limit(async () => 'done'), 'done');
    assert.equal(errors.length, 1);
  });
});
