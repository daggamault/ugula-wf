import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  acknowledgmentsOf,
  adjudicationOf,
  fileKindOf,
  isBalanced,
  patientCentsOf,
  paymentOutcomeOf
} from './inbound.ts';
import { respond } from './mock-respond.ts';
import { buildTA1, readInterchange } from './mock-waystar.ts';
import { build835 } from './mock-x835.ts';
import {
  sampleEnvelope,
  sampleRejectedX837,
  sampleSubmitter,
  sampleX837
} from './testing-samples.ts';
import { type RemittanceClaim, read835 } from './x835.ts';
import { build837 } from './x837.ts';

const now = new Date('2026-11-03T12:00:00Z');

const file837 = build837(sampleSubmitter, [sampleX837, sampleRejectedX837], sampleEnvelope);

const answer = respond(file837, now);

describe('fileKindOf', () => {
  it('tells each clearinghouse answer by its content', () => {
    const interchange = readInterchange(file837);
    assert.ok(interchange);
    assert.deepEqual(
      [
        answer.ack999,
        answer.ack277 ?? '',
        answer.remit835 ?? '',
        buildTA1(interchange, '008', now),
        file837,
        'not x12'
      ].map(fileKindOf),
      ['999', '277ca', '835', 'ta1', 'other', 'other']
    );
  });
});

describe('acknowledgmentsOf', () => {
  it('reads a 999 by the control number of the file it answers', () => {
    assert.deepEqual(acknowledgmentsOf('999', answer.ack999), [
      { by: 'controlNumber', controlNumber: 42, accepted: true, note: '' }
    ]);
  });

  it('reads a rejected 999 with what was wrong', () => {
    const bad = respond(file837.replace(/CLM\*[^~]*~\n?/g, ''), now);
    const [ack] = acknowledgmentsOf('999', bad.ack999);
    assert.equal(ack?.by === 'controlNumber' && ack.accepted, false);
    assert.match(ack?.note ?? '', /^The clearinghouse rejected the 837P/);
  });

  it('reads a TA1 rejecting the whole interchange', () => {
    const interchange = readInterchange(file837);
    assert.ok(interchange);
    assert.deepEqual(acknowledgmentsOf('ta1', buildTA1(interchange, '008', now)), [
      {
        by: 'controlNumber',
        controlNumber: 42,
        accepted: false,
        note: 'The clearinghouse rejected the file: Invalid interchange receiver ID'
      }
    ]);
  });

  it('reads a 277CA claim by claim, with the payer claim number or why it was rejected', () => {
    const acks = acknowledgmentsOf('277ca', answer.ack277 ?? '');
    assert.deepEqual(
      acks.map((a) =>
        a.by === 'claimNumber' ? [a.claimNumber, a.status, a.payerClaimNumber] : null
      ),
      [
        ['c-1', 'accepted', 'MOCK-c-1'],
        ['c-2', 'rejected', null]
      ]
    );
    assert.match(acks[1]?.note ?? '', /Invalid member ID/);
  });

  it('reads nothing from a file that acknowledges nothing', () => {
    assert.deepEqual(acknowledgmentsOf('835', answer.remit835 ?? ''), []);
  });
});

const claim = (patch: Partial<RemittanceClaim> = {}): RemittanceClaim => ({
  claimNumber: 'c-1',
  status: '1',
  chargeCents: 10_000,
  paidCents: 7_200,
  patientCents: 1_800,
  payerClaimNumber: 'P1',
  adjustments: [],
  remarks: [],
  crossoverPayer: null,
  denied: false,
  reversal: false,
  services: [],
  ...patch
});

describe('posting a remittance', () => {
  it('names what the payer did with the claim', () => {
    assert.deepEqual(
      [
        claim(),
        claim({ status: '4', denied: true }),
        claim({ status: '19' }),
        claim({ crossoverPayer: 'MEDIGAP' }),
        claim({ status: '22', reversal: true })
      ].map(paymentOutcomeOf),
      ['paid', 'denied', 'forwarded', 'forwarded', 'reversed']
    );
  });

  it('keeps what the payer paid and adjusted, per claim and per line, for the next payer', () => {
    const [remit] = read835(answer.remit835 ?? '');
    const [paid] = remit?.claims ?? [];
    assert.ok(paid);
    const a = adjudicationOf(paid, '2026-11-03');
    assert.deepEqual([a.paidCents, a.adjustedCents, a.paidOn], [67_860, 26_390, '2026-11-03']);
    assert.deepEqual(a.adjustments, [
      { group: 'CO', reason: '45', cents: 9_425 },
      { group: 'PR', reason: '2', cents: 16_965 }
    ]);
    assert.deepEqual(
      a.lines.map((l) => [l.line, l.code, l.paidCents, l.units]),
      [
        [1, 'A0427', 61_200, 1],
        [2, 'A0425', 6_660, 7.4]
      ]
    );
    assert.equal(patientCentsOf(a.adjustments), 16_965);
  });

  it('balances a remittance when its claims less its provider adjustments make the payment', () => {
    const text = build835(
      [
        {
          claims: [{ claimNumber: 'c-1', chargeCents: 10_000, paidCents: 7_000 }],
          providerAdjustments: [{ reason: 'WO', cents: 500 }]
        }
      ],
      { createdAt: now }
    );
    const [remit] = read835(text);
    assert.ok(remit);
    assert.equal(isBalanced(remit), true);
    assert.equal(isBalanced({ ...remit, totalCents: 7_000 }), false);
  });
});
