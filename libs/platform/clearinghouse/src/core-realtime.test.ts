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

describe('createCoreRealtime', () => {
  it('posts a CORE 2.2.0 envelope with Basic auth, never following redirects, and returns the payload', async () => {
    const seen: {
      url: string;
      redirect: RequestInit['redirect'];
      auth: string | null;
      fields: Record<string, string>;
    }[] = [];
    const send = createCoreRealtime(
      config(async (url, init) => {
        const form = init?.body as FormData;
        seen.push({
          url: String(url),
          redirect: init?.redirect,
          auth: new Headers(init?.headers).get('authorization'),
          fields: Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]))
        });
        return reply({
          PayloadType: 'X12_271_Response_005010X279A1',
          PayloadID: 'payload-1',
          Payload: 'ISA*271~',
          ErrorCode: 'Success',
          ErrorMessage: ''
        });
      })
    );
    assert.deepEqual(await send('X12_270_Request_005010X279A1', 'ISA*270~'), {
      ok: true,
      payloadType: 'X12_271_Response_005010X279A1',
      payload: 'ISA*271~'
    });
    assert.deepEqual(seen, [
      {
        url: 'http://ch.test/core/realtime',
        redirect: 'manual',
        auth: `Basic ${Buffer.from('agency:s3cret').toString('base64')}`,
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

  it('reports envelope errors, HTTP errors, mismatched answers and garbage', async () => {
    const answer = (r: Response) => createCoreRealtime(config(async () => r))('T', 'x');
    assert.deepEqual(
      await answer(
        reply({ PayloadType: 'CoreEnvelopeError', ErrorCode: 'Payload', ErrorMessage: 'Bad 270' })
      ),
      { ok: false, error: 'Payload: Bad 270' }
    );
    assert.deepEqual(await answer(reply({}, 401)), {
      ok: false,
      error: 'The clearinghouse answered HTTP 401'
    });
    assert.deepEqual(await answer(reply({ PayloadID: 'other', ErrorCode: 'Success' })), {
      ok: false,
      error: 'The clearinghouse answered another request'
    });
    assert.deepEqual(await answer(new Response('plain text')), {
      ok: false,
      error: 'The clearinghouse answer is not a CORE envelope'
    });
  });

  it('gives up after the timeout and reports unreachable servers', async () => {
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
    const down = createCoreRealtime(
      config(async () => {
        throw new TypeError('fetch failed');
      })
    );
    assert.deepEqual(await down('T', 'x'), {
      ok: false,
      error: 'Could not reach the clearinghouse: fetch failed'
    });
  });

  it('treats an aborted request as a timeout and reports thrown values that are not errors', async () => {
    const aborted = createCoreRealtime(
      config(async () => {
        throw new DOMException('stopped', 'AbortError');
      }, 2500)
    );
    assert.deepEqual(await aborted('T', 'x'), {
      ok: false,
      error: 'The clearinghouse did not answer within 2.5s'
    });
    const other = createCoreRealtime(
      config(async () => {
        throw new DOMException('bad', 'SyntaxError');
      })
    );
    assert.deepEqual(await other('T', 'x'), {
      ok: false,
      error: 'Could not reach the clearinghouse: bad'
    });
    const odd = createCoreRealtime(
      config(async () => {
        throw 'socket closed';
      })
    );
    assert.deepEqual(await odd('T', 'x'), {
      ok: false,
      error: 'Could not reach the clearinghouse: socket closed'
    });
  });

  it('reads an error code without a message, and file fields as blank', async () => {
    const answer = (r: Response) => createCoreRealtime(config(async () => r))('T', 'x');
    assert.deepEqual(await answer(reply({ ErrorCode: 'Receiver' })), {
      ok: false,
      error: 'Receiver'
    });
    const form = new FormData();
    form.append('PayloadType', 'X12_271');
    form.append('Payload', new Blob(['ISA*271~']), 'reply.x12');
    assert.deepEqual(await answer(new Response(form)), {
      ok: true,
      payloadType: 'X12_271',
      payload: ''
    });
  });

  it('stamps a fresh payload id when none is injected', async () => {
    const fields: Record<string, string>[] = [];
    const { newId: _newId, ...rest } = config(async (_, init) => {
      const form = init?.body as FormData;
      fields.push(Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)])));
      return reply({ PayloadType: 'R', Payload: 'p' });
    });
    const send = createCoreRealtime(rest);
    assert.deepEqual(await send('T', 'x'), { ok: true, payloadType: 'R', payload: 'p' });
    await send('T', 'x');
    const [first, second] = fields;
    assert.match(first?.PayloadID ?? '', /^[0-9a-f-]{36}$/);
    assert.notEqual(first?.PayloadID, second?.PayloadID);
  });
});
