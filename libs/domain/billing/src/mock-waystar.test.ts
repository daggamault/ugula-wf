import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  buildTA1,
  downloadName,
  isActiveMember,
  type MockClaimState,
  read270,
  read276,
  readInterchange,
  respondToClaimStatus,
  respondToClaims,
  respondToEligibility
} from './mock-waystar.ts';
import { sampleSubmitter, sampleX837 } from './testing.ts';
import { build270, type EligibilityRequest } from './x270.ts';
import { read271 } from './x271.ts';
import { build276 } from './x276.ts';
import { readClaimStatus } from './x277-status.ts';
import { read835 } from './x835.ts';
import { build837 } from './x837.ts';
import { read999 } from './x999.ts';

const now = new Date('2026-11-04T15:30:00Z');

const envelope = { controlNumber: 42, createdAt: now };

const waystar = { ...sampleSubmitter, receiverId: 'WAYSTAR' };

const inquiry = (memberId: string): EligibilityRequest => ({
  trace: `T-${memberId}`,
  payer: { name: 'MEDICARE', payerId: 'MCR' },
  subscriber: {
    lastName: 'KLINE',
    firstName: 'DOROTHY',
    memberId,
    birthDate: '1950-01-01',
    sex: 'F'
  },
  serviceDate: '2026-10-01'
});

describe('readInterchange', () => {
  it('reads the ISA sender, receiver and control number', () => {
    assert.deepEqual(readInterchange(build270(waystar, [inquiry('A1')], envelope)), {
      sender: waystar.submitterId,
      receiver: 'WAYSTAR',
      controlNumber: '000000042',
      production: false
    });
    assert.equal(readInterchange('not x12'), null);
  });
});

describe('buildTA1', () => {
  it('rejects the interchange back to its sender with a note code', () => {
    const ta1 = buildTA1(
      { sender: 'SUB01', receiver: 'X', controlNumber: '42', production: false },
      '008',
      now
    );
    assert.match(ta1, /ISA\*00\* {10}\*00\* {10}\*ZZ\*WAYSTAR {8}\*ZZ\*SUB01 {10}\*/);
    assert.match(ta1, /TA1\*000000042\*261104\*1530\*R\*008~/);
    assert.match(ta1, /IEA\*0\*000000042~/);
  });
});

describe('respondToClaims', () => {
  const claims = (receiverId: string) =>
    build837({ ...sampleSubmitter, receiverId }, [sampleX837], envelope);

  it('answers a TA1 and nothing else when ISA08 is not Waystar', () => {
    const r = respondToClaims(claims('DEMOCH'), now);
    assert.ok(r.ta1?.includes('*R*008'));
    assert.equal(r.ack999, '');
    assert.equal(r.ack277, null);
    assert.equal(r.remit835, null);
    assert.match(r.error ?? '', /ISA08 must be WAYSTAR or ZIRMED, not DEMOCH/);
  });

  it('accepts ZIRMED as the receiver of older accounts', () => {
    assert.equal(respondToClaims(claims('zirmed'), now).ta1, null);
  });

  it('acknowledges Waystar claims and pays only payers enrolled for ERA', () => {
    const paid = respondToClaims(claims('WAYSTAR'), now);
    assert.equal(paid.ta1, null);
    assert.equal(read999(paid.ack999)[0]?.accepted, true);
    assert.equal(read835(paid.remit835 ?? '').length, 1);
    const unenrolled = respondToClaims(claims('WAYSTAR'), now, () => false);
    assert.ok(unenrolled.ack277);
    assert.equal(unenrolled.remit835, null);
  });
});

describe('eligibility', () => {
  const file = build270(waystar, [inquiry('ABC1'), inquiry('INACTIVE9')], envelope);

  it('reads each 270 inquiry with its payer and trace', () => {
    const { interchange, inquiries } = read270(file);
    assert.equal(interchange?.receiver, 'WAYSTAR');
    assert.deepEqual(
      inquiries.map((q) => [q.trace, q.payer.id, q.subscriber.memberId, q.subscriber.lastName]),
      [
        ['T-ABC1', 'MCR', 'ABC1', 'KLINE'],
        ['T-INACTIVE9', 'MCR', 'INACTIVE9', 'KLINE']
      ]
    );
    assert.throws(() => read270(build837(waystar, [sampleX837], envelope)), /No 270/);
  });

  it('answers each inquiry with a 271, inactive when the member ID says so', () => {
    assert.equal(isActiveMember('abc'), true);
    assert.equal(isActiveMember('inactive-1'), false);
    const answers = respondToEligibility(file, now).map((a) => read271(a)[0]);
    assert.deepEqual(
      answers.map((a) => [a?.trace, a?.active]),
      [
        ['T-ABC1', true],
        ['T-INACTIVE9', false]
      ]
    );
  });
});

describe('Medicare Advantage', () => {
  it('names a Medicare Advantage plan for member IDs that start with ADVANTAGE', () => {
    const file = build270(waystar, [inquiry('ADVANTAGE1'), inquiry('B2')], envelope);
    assert.deepEqual(
      respondToEligibility(file, now).map((a) => read271(a)[0]?.advantagePlan),
      ['SUNSHINE MEDICARE ADVANTAGE', null]
    );
  });
});

describe('claim status', () => {
  const status = (claimNumber: string, payerClaimNumber: string | null = null) => ({
    trace: claimNumber,
    payer: { name: 'MEDICARE', payerId: 'MCR' },
    subscriber: { ...inquiry('A1').subscriber },
    patient: null,
    claimNumber,
    payerClaimNumber,
    chargeCents: 100_000,
    serviceDate: '2026-10-01'
  });
  const file = build276(
    waystar,
    [status('11'), status('12', 'PCN-12'), status('13'), status('14')],
    envelope
  );

  it('reads each 276 query with its payer, claim number and charge', () => {
    const { interchange, queries } = read276(file);
    assert.equal(interchange?.sender, waystar.submitterId);
    assert.deepEqual(queries[1], {
      trace: '12',
      claimNumber: '12',
      payerClaimNumber: 'PCN-12',
      chargeCents: 100_000,
      payer: { name: 'MEDICARE', id: 'MCR' }
    });
    assert.throws(() => read276(build270(waystar, [inquiry('A1')], envelope)), /No 276/);
  });

  it('answers in process, paid, rejected or not found by what happened to each claim', () => {
    const states: Record<string, MockClaimState> = {
      '11': 'accepted',
      '12': 'paid',
      '13': 'rejected'
    };
    const answer = respondToClaimStatus(file, now, (n) => states[n] ?? 'unknown');
    assert.equal(readInterchange(answer)?.receiver, waystar.submitterId);
    assert.deepEqual(
      readClaimStatus(answer).map((s) => [
        s.claimNumber,
        s.meaning,
        s.paidCents,
        s.payerClaimNumber
      ]),
      [
        ['11', 'inProcess', 0, 'MOCK-11'],
        ['12', 'paid', 80_000, 'PCN-12'],
        ['13', 'rejected', 0, 'MOCK-13'],
        ['14', 'notFound', 0, null]
      ]
    );
  });
});

describe('downloadName', () => {
  it('names downloads by client, type, time and sequence', () => {
    assert.equal(downloadName('DEV01', '999', now, 7), 'DEV01_999_20261104153000_0007');
  });
});
