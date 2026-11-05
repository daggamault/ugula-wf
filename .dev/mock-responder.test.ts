import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build270 } from '@ugula/billing';
import { sampleSubmitter } from '@ugula/billing/testing';
import { createMockFiles } from './mock-files.ts';
import { createResponder, type Responders } from './mock-responder.ts';
import { DOWNLOAD, UPLOAD } from './mock-uploads.ts';

type ClaimsResult = ReturnType<Responders['claims']>;

const now = new Date('2026-11-04T15:30:00Z');

const isa = build270(
  { ...sampleSubmitter, receiverId: 'WAYSTAR' },
  [
    {
      trace: 'T1',
      payer: { name: 'MEDICARE', payerId: 'MCR' },
      subscriber: {
        lastName: 'KLINE',
        firstName: 'DOROTHY',
        memberId: 'A1',
        birthDate: null,
        sex: null
      },
      serviceDate: '2026-10-01'
    }
  ],
  { controlNumber: 1, createdAt: now }
);

const claimsResult = (over: Partial<ClaimsResult> = {}): ClaimsResult => ({
  inbound: null,
  error: null,
  ack999: '999',
  ack277: null,
  remit835: null,
  accepted: [],
  rejected: [],
  ta1: null,
  ...over
});

const setup = (claims: ClaimsResult, eraUnenrolled = new Set<string>()) => {
  const timers: { run: () => void; ms: number }[] = [];
  const lines: string[] = [];
  const statusQueries: string[][] = [];
  const files = createMockFiles('ugula', () => 0, [UPLOAD, DOWNLOAD]);
  const respond: Responders = {
    claims: () => claims,
    eligibility: () => ['271-a', '271-b'],
    claimStatus: (_text, _now, stateOf) => {
      statusQueries.push(['11', '12', '13'].map(stateOf));
      return '277';
    }
  };
  const responder = createResponder({
    files,
    respond,
    now: () => now,
    later: (run, ms) => void timers.push({ run, ms }),
    log: (line) => void lines.push(line),
    remitDelayMs: 20_000,
    eraUnenrolled
  });
  const upload = (name: string) => {
    files.put(`${UPLOAD}/${name}`, isa);
    responder.received(`${UPLOAD}/${name}`);
    for (const t of timers.splice(0)) t.run();
  };
  const downloads = () =>
    [...files.files.entries()]
      .filter(([p]) => p.startsWith(`${DOWNLOAD}/`))
      .map(([p, f]) => [p.slice(DOWNLOAD.length + 1), f.data.toString()]);
  return { files, timers, lines, statusQueries, responder, upload, downloads };
};

const client = sampleSubmitter.submitterId;

describe('createResponder', () => {
  it('waits before picking up an upload and ignores partial files', () => {
    const { responder, timers, files } = setup(claimsResult());
    files.put(`${UPLOAD}/B1.CLP.part`, isa);
    responder.received(`${UPLOAD}/B1.CLP.part`);
    responder.received(`${DOWNLOAD}/R1.999`);
    assert.equal(timers.length, 0);
    responder.received(`${UPLOAD}/B1.CLP`);
    assert.deepEqual(
      timers.map((t) => t.ms),
      [2000]
    );
  });

  it('answers an 837P with a 999 and 277CA, then the 835 later, tracking each claim', () => {
    const inbound = {
      groupControlNumber: '7',
      claims: [
        { claimNumber: '11', payer: { id: 'MCR' } },
        { claimNumber: '13', payer: { id: 'NOERA' } }
      ]
    } as unknown as ClaimsResult['inbound'];
    const { upload, downloads, timers, responder, statusQueries, files } = setup(
      claimsResult({
        inbound,
        ack277: '277CA',
        remit835: '835',
        accepted: ['11', '13'],
        rejected: ['12']
      }),
      new Set(['NOERA'])
    );
    files.put(`${UPLOAD}/B1.CLP`, isa);
    responder.received(`${UPLOAD}/B1.CLP`);
    timers.splice(0)[0]?.run();
    assert.deepEqual(downloads(), [
      [`${client}_999_20261104153000_0001.999`, '999'],
      [`${client}_277CA_20261104153000_0002.277`, '277CA']
    ]);
    assert.equal(timers[0]?.ms, 20_000);
    timers.splice(0)[0]?.run();
    assert.equal(downloads()[2]?.[1], '835');
    upload('S1.CLS');
    assert.deepEqual(statusQueries, [['paid', 'rejected', 'accepted']]);
  });

  it('answers a TA1 when the envelope is rejected', () => {
    const { upload, downloads, lines } = setup(claimsResult({ ta1: 'TA1', error: 'bad ISA08' }));
    upload('B1.CLP');
    assert.deepEqual(
      downloads().map(([, text]) => text),
      ['TA1']
    );
    assert.ok(lines.includes('rejected B1.CLP: bad ISA08'));
  });

  it('answers each 270 inquiry with its own 271', () => {
    const { upload, downloads } = setup(claimsResult());
    upload('E1.ELG');
    assert.deepEqual(
      downloads().map(([, text]) => text),
      ['271-a', '271-b']
    );
  });

  it('rejects misnamed uploads and removes them unanswered', () => {
    const { upload, downloads, lines, files } = setup(claimsResult());
    upload('B1.v2.CLP');
    upload('B1.txt');
    assert.deepEqual(downloads(), []);
    assert.equal(files.files.size, 0);
    assert.deepEqual(lines, [
      'rejected B1.v2.CLP: file names may not contain extra periods',
      'rejected B1.txt: upload 837P files as .CLP, 270 as .ELG and 276 as .CLS'
    ]);
  });

  it('logs a responder failure instead of crashing', () => {
    const { files, responder, timers, lines } = setup(claimsResult());
    const failing = createResponder({
      files,
      respond: {
        claims: () => claimsResult(),
        eligibility: () => {
          throw new Error('No 270');
        },
        claimStatus: () => ''
      },
      now: () => now,
      later: (run) => run(),
      log: (line) => void lines.push(line),
      remitDelayMs: 0,
      eraUnenrolled: new Set()
    });
    files.put(`${UPLOAD}/E1.ELG`, 'junk');
    failing.received(`${UPLOAD}/E1.ELG`);
    assert.deepEqual(lines, ['rejected E1.ELG: No 270']);
    assert.equal(responder.stateOf('11'), 'unknown');
    assert.deepEqual(timers, []);
  });
});
