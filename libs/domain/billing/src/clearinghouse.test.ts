import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  type BatchTransport,
  CLEARINGHOUSE_VENDORS,
  createClearinghouse,
  exchangeFileName,
  FILE_EXTENSION_PATTERN,
  type RealtimeTransport,
  VENDOR_PRESETS,
  WAYSTAR_EXTENSIONS
} from './clearinghouse.ts';

const fakeBatch = () => {
  const uploads: [string, string][] = [];
  const batch: BatchTransport = {
    upload: async (name, bytes) => {
      uploads.push([name, new TextDecoder().decode(bytes)]);
      return `/upload/${name}`;
    },
    list: async () => [
      { path: '/download/a.999', name: 'a.999', size: 3, modifiedAt: new Date(0) }
    ],
    download: async () => new TextEncoder().encode('ack'),
    remove: async () => undefined
  };
  return { batch, uploads };
};

const bytes = (s: string) => new TextEncoder().encode(s);

describe('VENDOR_PRESETS', () => {
  it('follows Waystar for Waystar and the mock, and names every vendor', () => {
    assert.deepEqual(Object.keys(VENDOR_PRESETS), [...CLEARINGHOUSE_VENDORS]);
    assert.deepEqual(VENDOR_PRESETS.waystar.extensions, {
      claims: '.CLP',
      eligibility: '.ELG',
      claimStatus: '.CLS'
    });
    assert.equal(VENDOR_PRESETS.waystar.receiverId, 'WAYSTAR');
    assert.equal(VENDOR_PRESETS.mock.extensions, WAYSTAR_EXTENSIONS);
    assert.ok(VENDOR_PRESETS.mock.realtimeUrl?.endsWith('/core/realtime'));
    const pattern = new RegExp(FILE_EXTENSION_PATTERN);
    for (const preset of Object.values(VENDOR_PRESETS)) {
      assert.ok(Object.values(preset.extensions).every((e) => pattern.test(e)));
    }
    assert.ok(!pattern.test('CLP') && !pattern.test('.C.P'));
  });
});

describe('createClearinghouse', () => {
  it('uploads each batch file with the extension the clearinghouse expects', async () => {
    const { batch, uploads } = fakeBatch();
    const ch = createClearinghouse({
      batch,
      realtime: null,
      extensions: WAYSTAR_EXTENSIONS,
      afterDownload: 'keep'
    });
    assert.equal(await ch.submitClaims('837P-1', bytes('a')), '837P-1.CLP');
    assert.equal(await ch.submitEligibility('270-1', bytes('b')), '270-1.ELG');
    assert.equal(await ch.submitClaimStatus('276-1', bytes('c')), '276-1.CLS');
    assert.deepEqual(uploads, [
      ['837P-1.CLP', 'a'],
      ['270-1.ELG', 'b'],
      ['276-1.CLS', 'c']
    ]);
    assert.equal(ch.checkEligibility, null);
    assert.equal(ch.checkClaimStatus, null);
    assert.equal(ch.afterDownload, 'keep');
    assert.equal((await ch.pollResponses())[0]?.name, 'a.999');
  });

  it('sends real-time requests as CORE payloads and accepts only the matching answer', async () => {
    const sent: string[] = [];
    const realtime: RealtimeTransport = async (payloadType, payload) => {
      sent.push(payloadType);
      if (payload === 'fail') return { ok: false, error: 'Timed out' };
      if (payload === 'wrong') return { ok: true, payloadType: 'CoreEnvelopeError', payload: '' };
      return {
        ok: true,
        payloadType: payloadType
          .replace('270_Request', '271_Response')
          .replace('276_Request', '277_Response'),
        payload: `answer to ${payload}`
      };
    };
    const ch = createClearinghouse({
      batch: fakeBatch().batch,
      realtime,
      extensions: WAYSTAR_EXTENSIONS,
      afterDownload: 'delete'
    });
    assert.deepEqual(await ch.checkEligibility?.('270'), { ok: true, text: 'answer to 270' });
    assert.deepEqual(await ch.checkClaimStatus?.('276'), { ok: true, text: 'answer to 276' });
    assert.deepEqual(await ch.checkEligibility?.('fail'), { ok: false, error: 'Timed out' });
    assert.deepEqual(await ch.checkClaimStatus?.('wrong'), {
      ok: false,
      error: 'The clearinghouse answered CoreEnvelopeError'
    });
    assert.deepEqual(sent, [
      'X12_270_Request_005010X279A1',
      'X12_276_Request_005010X212',
      'X12_270_Request_005010X279A1',
      'X12_276_Request_005010X212'
    ]);
  });
});

describe('exchangeFileName', () => {
  it('names files by transaction, control number and id, with no extra periods', () => {
    assert.equal(
      exchangeFileName('claims', 7, '0195f2a4-0000-7000-8000-000000000001'),
      '837P-000000007-0195f2a4'
    );
    assert.equal(exchangeFileName('eligibility', 12, 'abcd-ef01-2345'), '270-000000012-abcdef01');
    assert.equal(exchangeFileName('claimStatus', 3, '12345678-9'), '276-000000003-12345678');
  });
});
