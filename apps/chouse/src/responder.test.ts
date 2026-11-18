import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build270, sampleSubmitter } from '@ugula/billing/testing';
import { createMockFiles } from './files.ts';
import { createResponder, type Responders } from './responder.ts';
import { DOWNLOAD, UPLOAD } from './uploads.ts';

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

type Setup = {
  claims?: ClaimsResult;
  eraUnenrolled?: Set<string>;
  respond?: Partial<Responders>;
};

const setup = ({ claims = claimsResult(), eraUnenrolled = new Set(), respond }: Setup = {}) => {
  const timers: { run: () => void; ms: number }[] = [];
  const lines: string[] = [];
  const statusQueries: string[][] = [];
  const files = createMockFiles('ugula', () => 0, [UPLOAD, DOWNLOAD]);
  const responder = createResponder({
    files,
    respond: {
      claims: () => claims,
      eligibility: () => ['271-a', '271-b'],
      claimStatus: (_text, _now, stateOf) => {
        statusQueries.push(['11', '12', '13'].map(stateOf));
        return '277';
      },
      ...respond
    },
    now: () => now,
    later: (run, ms) => void timers.push({ run, ms }),
    log: (line) => void lines.push(line),
    remitDelayMs: 20_000,
    eraUnenrolled
  });
  const upload = (name: string, text = isa) => {
    files.put(`${UPLOAD}/${name}`, text);
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
  it('waits two seconds before picking up a finished upload and ignores partial files', () => {
    const { responder, timers, files } = setup();
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

  it('skips an upload that is gone by pickup time', () => {
    const { responder, timers, files, lines, downloads } = setup();
    files.put(`${UPLOAD}/B1.CLP`, isa);
    responder.received(`${UPLOAD}/B1.CLP`);
    files.files.delete(`${UPLOAD}/B1.CLP`);
    timers.splice(0)[0]?.run();
    assert.deepEqual(downloads(), []);
    assert.deepEqual(lines, []);
  });

  it('answers an 837P with a 999 and 277CA, then the 835 later, tracking each claim', () => {
    const inbound = {
      groupControlNumber: '7',
      claims: [
        { claimNumber: '11', payer: { id: 'MCR' } },
        { claimNumber: '13', payer: { id: 'NOERA' } }
      ]
    } as unknown as ClaimsResult['inbound'];
    const { upload, downloads, timers, responder, statusQueries, files, lines } = setup({
      claims: claimsResult({
        inbound,
        ack277: '277CA',
        remit835: '835',
        accepted: ['11', '13'],
        rejected: ['12']
      }),
      eraUnenrolled: new Set(['NOERA'])
    });
    files.put(`${UPLOAD}/B1.CLP`, isa);
    responder.received(`${UPLOAD}/B1.CLP`);
    timers.splice(0)[0]?.run();
    assert.deepEqual(downloads(), [
      [`${client}_999_20261104153000_0001.999`, '999'],
      [`${client}_277CA_20261104153000_0002.277`, '277CA']
    ]);
    assert.deepEqual(['11', '12', '13', '14'].map(responder.stateOf), [
      'accepted',
      'rejected',
      'accepted',
      'unknown'
    ]);
    assert.deepEqual(
      timers.map((t) => t.ms),
      [20_000]
    );
    timers.splice(0)[0]?.run();
    assert.deepEqual(downloads()[2], [`${client}_ERA_20261104153000_0003.835`, '835']);
    upload('S1.CLS');
    assert.deepEqual(statusQueries, [['paid', 'rejected', 'accepted']]);
    assert.deepEqual(lines, [
      'picked up B1.CLP (GS06 7, 2 claims)',
      `wrote /download/${client}_999_20261104153000_0001.999`,
      '277CA accepted 11, 13; rejected 12',
      `wrote /download/${client}_277CA_20261104153000_0002.277`,
      '835 due in 20s',
      `wrote /download/${client}_ERA_20261104153000_0003.835`,
      `wrote /download/${client}_CLAIMSTATUS_20261104153000_0004.277`,
      'picked up S1.CLS'
    ]);
  });

  it('answers an unreadable 837P without tracking claims or scheduling an 835', () => {
    const { upload, downloads, lines, timers, responder } = setup({
      claims: claimsResult({ error: 'no GS segment', ack277: '277CA' })
    });
    upload('B1.CLP');
    assert.deepEqual(downloads(), [
      [`${client}_999_20261104153000_0001.999`, '999'],
      [`${client}_277CA_20261104153000_0002.277`, '277CA']
    ]);
    assert.deepEqual(timers, []);
    assert.equal(responder.stateOf('11'), 'unknown');
    assert.deepEqual(
      lines.filter((l) => !l.startsWith('wrote')),
      ['picked up B1.CLP (unreadable: no GS segment)', '277CA accepted none; rejected none']
    );
  });

  it('answers a TA1 alone when the envelope is rejected', () => {
    const { upload, downloads, lines, responder } = setup({
      claims: claimsResult({ ta1: 'TA1', error: 'bad ISA08', accepted: ['11'] })
    });
    upload('B1.CLP');
    assert.deepEqual(downloads(), [[`${client}_TA1_20261104153000_0001.TA1`, 'TA1']]);
    assert.equal(responder.stateOf('11'), 'unknown');
    assert.deepEqual(lines, [
      'rejected B1.CLP: bad ISA08',
      `wrote /download/${client}_TA1_20261104153000_0001.TA1`
    ]);
  });

  it('answers each 270 inquiry with its own 271', () => {
    const { upload, downloads, lines } = setup();
    upload('E1.ELG');
    assert.deepEqual(downloads(), [
      [`${client}_271_20261104153000_0001.271`, '271-a'],
      [`${client}_271_20261104153000_0002.271`, '271-b']
    ]);
    assert.equal(lines[0], 'picked up E1.ELG (2 inquiries)');
  });

  it('names the answers to an upload without a readable ISA sender UNKNOWN', () => {
    const { upload, downloads } = setup();
    upload('E1.ELG', 'junk');
    assert.deepEqual(
      downloads().map(([name]) => name),
      ['UNKNOWN_271_20261104153000_0001.271', 'UNKNOWN_271_20261104153000_0002.271']
    );
  });

  it('rejects misnamed uploads and removes them unanswered', () => {
    const { upload, downloads, lines, files } = setup();
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
    const { upload, downloads, lines } = setup({
      respond: {
        eligibility: () => {
          throw new Error('No 270');
        },
        claimStatus: () => {
          throw 'no 276';
        }
      }
    });
    upload('E1.ELG');
    upload('S1.CLS');
    assert.deepEqual(downloads(), []);
    assert.deepEqual(lines, ['rejected E1.ELG: No 270', 'rejected S1.CLS: no 276']);
  });
});
