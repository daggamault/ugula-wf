import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORE_PATH, handleCore } from './core.ts';

const credentials = { username: 'ugula', password: 'secret' };

const deps = {
  credentials,
  respond: {
    eligibility: (x12: string): string[] => {
      if (x12 !== '270') throw new Error('No 270');
      return ['271'];
    },
    claimStatus: (_x12: string, _now: Date, stateOf: (n: string) => string): string =>
      `277 ${stateOf('11')}`
  },
  stateOf: () => 'paid' as const,
  now: () => new Date('2026-11-04T15:30:00Z'),
  log: (_line: string) => {}
};

const auth = `Basic ${Buffer.from('ugula:secret').toString('base64')}`;

const post = (
  fields: Record<string, string>,
  headers: Record<string, string> = { authorization: auth }
) => {
  const body = new FormData();
  for (const [k, v] of Object.entries(fields)) body.append(k, v);
  return new Request(`http://localhost${CORE_PATH}`, { method: 'POST', headers, body });
};

const fieldsOf = async (res: Response) =>
  Object.fromEntries([...(await res.formData()).entries()].map(([k, v]) => [k, String(v)]));

const envelope = { PayloadID: 'P1', SenderID: 'SUB01' };

const request270 = { ...envelope, PayloadType: 'X12_270_Request_005010X279A1', Payload: '270' };

const request276 = { ...envelope, PayloadType: 'X12_276_Request_005010X212', Payload: '276' };

describe('handleCore', () => {
  it('answers a real-time 270 with a 271 in a CORE envelope', async () => {
    const res = await handleCore(post(request270), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(await fieldsOf(res), {
      ProcessingMode: 'RealTime',
      PayloadID: 'P1',
      TimeStamp: '2026-11-04T15:30:00.000Z',
      SenderID: 'WAYSTAR',
      ReceiverID: 'SUB01',
      CORERuleVersion: '2.2.0',
      PayloadType: 'X12_271_Response_005010X279A1',
      Payload: '271',
      ErrorCode: 'Success',
      ErrorMessage: ''
    });
  });

  it('answers a 276 from what happened to the claim', async () => {
    const fields = await fieldsOf(await handleCore(post(request276), deps));
    assert.deepEqual(
      [fields.PayloadType, fields.Payload, fields.ErrorCode],
      ['X12_277_Response_005010X212', '277 paid', 'Success']
    );
  });

  it('logs each answered request', async () => {
    const lines: string[] = [];
    await handleCore(post(request270), { ...deps, log: (line) => void lines.push(line) });
    assert.deepEqual(lines, ['real-time X12_270_Request_005010X279A1 P1 answered']);
  });

  it('answers an empty payload when a 270 yields no 271', async () => {
    const fields = await fieldsOf(
      await handleCore(post(request270), {
        ...deps,
        respond: { ...deps.respond, eligibility: () => [] }
      })
    );
    assert.deepEqual([fields.ErrorCode, fields.Payload], ['Success', '']);
  });

  it('returns an envelope error for an unknown or missing payload type', async () => {
    for (const [fields, message] of [
      [{ ...envelope, PayloadType: 'X' }, 'X'],
      [envelope, '']
    ] as const) {
      const res = await fieldsOf(await handleCore(post(fields), deps));
      assert.deepEqual(
        [res.PayloadType, res.ErrorCode, res.ErrorMessage, res.Payload],
        ['CoreEnvelopeError', 'PayloadTypeNotSupported', message, undefined]
      );
    }
  });

  it('returns an envelope error with the reason a payload could not be answered', async () => {
    const bad = await fieldsOf(await handleCore(post({ ...request270, Payload: 'junk' }), deps));
    assert.deepEqual(
      [bad.PayloadType, bad.ErrorCode, bad.ErrorMessage, bad.ReceiverID],
      ['CoreEnvelopeError', 'Payload', 'No 270', 'SUB01']
    );
    const thrown = await fieldsOf(
      await handleCore(post(request276), {
        ...deps,
        respond: {
          ...deps.respond,
          claimStatus: () => {
            throw 'no 276';
          }
        }
      })
    );
    assert.deepEqual([thrown.ErrorCode, thrown.ErrorMessage], ['Payload', 'no 276']);
  });

  it('challenges a request without the right Basic credentials', async () => {
    const wrong = `Basic ${Buffer.from('ugula:other').toString('base64')}`;
    for (const headers of [{}, { authorization: wrong }]) {
      const denied = await handleCore(post(request270, headers), deps);
      assert.equal(denied.status, 401);
      assert.equal(denied.headers.get('www-authenticate'), 'Basic');
    }
  });

  it('serves only POSTs to the real-time path', async () => {
    const headers = { authorization: auth };
    const wrongPath = await handleCore(
      new Request('http://localhost/other', { method: 'POST', headers }),
      deps
    );
    assert.equal(wrongPath.status, 404);
    const get = await handleCore(new Request(`http://localhost${CORE_PATH}`, { headers }), deps);
    assert.equal(get.status, 404);
  });
});
