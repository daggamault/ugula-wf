import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { CORE_PATH, handleCore } from './mock-core.ts';

const credentials = { username: 'ugula', password: 'secret' };

const deps = {
  credentials,
  respond: {
    eligibility: (x12: string) => {
      if (x12 !== '270') throw new Error('No 270');
      return ['271'];
    },
    claimStatus: (_x12: string, _now: Date, stateOf: (n: string) => string) =>
      `277 ${stateOf('11')}`
  },
  stateOf: () => 'paid' as const,
  now: () => new Date('2026-11-04T15:30:00Z'),
  log: () => {}
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

describe('handleCore', () => {
  it('answers a real-time 270 with a 271 in a CORE envelope', async () => {
    const res = await handleCore(
      post({ ...envelope, PayloadType: 'X12_270_Request_005010X279A1', Payload: '270' }),
      deps
    );
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
    const res = await handleCore(
      post({ ...envelope, PayloadType: 'X12_276_Request_005010X212', Payload: '276' }),
      deps
    );
    const fields = await fieldsOf(res);
    assert.equal(fields.PayloadType, 'X12_277_Response_005010X212');
    assert.equal(fields.Payload, '277 paid');
  });

  it('returns envelope errors for unknown payload types and unreadable payloads', async () => {
    const unknown = await fieldsOf(await handleCore(post({ ...envelope, PayloadType: 'X' }), deps));
    assert.deepEqual(
      [unknown.PayloadType, unknown.ErrorCode, unknown.ErrorMessage],
      ['CoreEnvelopeError', 'PayloadTypeNotSupported', 'X']
    );
    const bad = await fieldsOf(
      await handleCore(
        post({ ...envelope, PayloadType: 'X12_270_Request_005010X279A1', Payload: 'junk' }),
        deps
      )
    );
    assert.deepEqual(
      [bad.PayloadType, bad.ErrorCode, bad.ErrorMessage],
      ['CoreEnvelopeError', 'Payload', 'No 270']
    );
  });

  it('needs Basic auth on a POST to the real-time path', async () => {
    const denied = await handleCore(post({}, {}), deps);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('www-authenticate'), 'Basic');
    const wrongPath = await handleCore(
      new Request('http://localhost/other', { method: 'POST' }),
      deps
    );
    assert.equal(wrongPath.status, 404);
    const get = await handleCore(new Request(`http://localhost${CORE_PATH}`), deps);
    assert.equal(get.status, 404);
  });
});
