import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createCoreRealtime } from './core-realtime.ts';

const reply = (fields: Record<string, string>, status = 200) => {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  return status === 200 ? new Response(form) : new Response('no', { status });
};

const config = (fetch: typeof globalThis.fetch, timeoutMs = 1000) => ({
  url: 'http://ch.test/core/realtime',
  username: 'agency',
  password: 's3cret',
  senderId: 'SUB01',
  receiverId: 'WAYSTAR',
  timeoutMs,
  fetch,
  now: () => new Date('2026-11-04T15:30:00.123Z'),
  newId: () => 'payload-1'
});

const fieldsOf = (init: RequestInit | undefined) => {
  assert.ok(init?.body instanceof FormData);
  return Object.fromEntries([...init.body.entries()].map(([k, v]) => [k, String(v)]));
};

const answer = (r: Response) => createCoreRealtime(config(async () => r))('T', 'x');

const failing = (thrown: unknown, timeoutMs?: number) =>
  createCoreRealtime(
    config(async () => {
      throw thrown;
    }, timeoutMs)
  )('T', 'x');

describe('createCoreRealtime request', () => {
  it('posts a CORE 2.2.0 envelope with Basic auth, never following redirects', async () => {
    const seen: unknown[] = [];
    const send = createCoreRealtime(
      config(async (url, init) => {
        seen.push({
          url: String(url),
          method: init?.method,
          redirect: init?.redirect,
          auth: new Headers(init?.headers).get('authorization'),
          signal: init?.signal instanceof AbortSignal,
          fields: fieldsOf(init)
        });
        return reply({ PayloadType: 'R', Payload: 'p' });
      })
    );
    await send('X12_270_Request_005010X279A1', 'ISA*270~');
    assert.deepEqual(seen, [
      {
        url: 'http://ch.test/core/realtime',
        method: 'POST',
        redirect: 'manual',
        auth: `Basic ${Buffer.from('agency:s3cret').toString('base64')}`,
        signal: true,
        fields: {
          PayloadType: 'X12_270_Request_005010X279A1',
          ProcessingMode: 'RealTime',
          PayloadID: 'payload-1',
          TimeStamp: '2026-11-04T15:30:00Z',
          SenderID: 'SUB01',
          ReceiverID: 'WAYSTAR',
          CORERuleVersion: '2.2.0',
          Payload: 'ISA*270~'
        }
      }
    ]);
  });

  it('stamps a fresh payload id when none is injected', async () => {
    const ids: string[] = [];
    const { newId: _newId, ...rest } = config(async (_, init) => {
      ids.push(fieldsOf(init).PayloadID ?? '');
      return reply({ PayloadType: 'R', Payload: 'p' });
    });
    const send = createCoreRealtime(rest);
    await send('T', 'x');
    await send('T', 'x');
    assert.match(
      ids[0] ?? '',
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
    assert.notEqual(ids[0], ids[1]);
  });
});

describe('createCoreRealtime answers', () => {
  it('returns the payload of a successful answer to this request', async () => {
    assert.deepEqual(
      await answer(
        reply({
          PayloadType: 'X12_271_Response_005010X279A1',
          PayloadID: 'payload-1',
          Payload: 'ISA*271~',
          ErrorCode: 'Success',
          ErrorMessage: ''
        })
      ),
      { ok: true, payloadType: 'X12_271_Response_005010X279A1', payload: 'ISA*271~' }
    );
  });

  it('accepts an answer without a payload id or error code', async () => {
    assert.deepEqual(await answer(reply({ PayloadType: 'R', Payload: 'p' })), {
      ok: true,
      payloadType: 'R',
      payload: 'p'
    });
  });

  it('reads file fields as blank', async () => {
    const form = new FormData();
    form.append('PayloadType', 'X12_271');
    form.append('Payload', new Blob(['ISA*271~']), 'reply.x12');
    assert.deepEqual(await answer(new Response(form)), {
      ok: true,
      payloadType: 'X12_271',
      payload: ''
    });
  });

  it('reports an envelope error code with its message', async () => {
    assert.deepEqual(
      await answer(
        reply({ PayloadType: 'CoreEnvelopeError', ErrorCode: 'Payload', ErrorMessage: 'Bad 270' })
      ),
      { ok: false, error: 'Payload: Bad 270' }
    );
  });

  it('reports an error code without a message on its own', async () => {
    assert.deepEqual(await answer(reply({ ErrorCode: 'Receiver' })), {
      ok: false,
      error: 'Receiver'
    });
  });

  it('reports an answer to another request', async () => {
    assert.deepEqual(await answer(reply({ PayloadID: 'other', ErrorCode: 'Success' })), {
      ok: false,
      error: 'The clearinghouse answered another request'
    });
  });

  it('reports HTTP errors, redirects included', async () => {
    assert.deepEqual(await answer(reply({}, 401)), {
      ok: false,
      error: 'The clearinghouse answered HTTP 401'
    });
    assert.deepEqual(await answer(new Response(null, { status: 302 })), {
      ok: false,
      error: 'The clearinghouse answered HTTP 302'
    });
  });

  it('reports an answer that is not form data', async () => {
    assert.deepEqual(await answer(new Response('plain text')), {
      ok: false,
      error: 'The clearinghouse answer is not a CORE envelope'
    });
  });
});

describe('createCoreRealtime failures', () => {
  it('gives up after the timeout', async () => {
    const keepAlive = setTimeout(() => undefined, 1000);
    const slow = createCoreRealtime(
      config(
        (_, init) =>
          new Promise((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal?.reason))
          ),
        20
      )
    );
    assert.deepEqual(await slow('T', 'x'), {
      ok: false,
      error: 'The clearinghouse did not answer within 0.02s'
    });
    clearTimeout(keepAlive);
  });

  it('treats an aborted request as a timeout', async () => {
    assert.deepEqual(await failing(new DOMException('stopped', 'AbortError'), 2500), {
      ok: false,
      error: 'The clearinghouse did not answer within 2.5s'
    });
  });

  it('reports unreachable servers with the error message', async () => {
    assert.deepEqual(await failing(new TypeError('fetch failed')), {
      ok: false,
      error: 'Could not reach the clearinghouse: fetch failed'
    });
    assert.deepEqual(await failing(new DOMException('bad', 'SyntaxError')), {
      ok: false,
      error: 'Could not reach the clearinghouse: bad'
    });
  });

  it('reports thrown values that are not errors', async () => {
    assert.deepEqual(await failing('socket closed'), {
      ok: false,
      error: 'Could not reach the clearinghouse: socket closed'
    });
  });
});
