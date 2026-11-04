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
  it('posts a CORE 2.2.0 envelope with Basic auth and returns the payload', async () => {
    const seen: { url: string; auth: string | null; fields: Record<string, string> }[] = [];
    const send = createCoreRealtime(
      config(async (url, init) => {
        const form = init?.body as FormData;
        seen.push({
          url: String(url),
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
});
