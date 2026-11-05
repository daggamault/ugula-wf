import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { respond } from './mock-respond.ts';
import {
  sampleDependentX837,
  sampleEnvelope,
  sampleRejectedX837,
  sampleSubmitter,
  sampleX837
} from './testing.ts';
import { readX12 } from './x12.ts';
import { read277 } from './x277.ts';
import { read835 } from './x835.ts';
import { build837, type X837Claim } from './x837.ts';
import { read999 } from './x999.ts';

const isaOf = (text: string) => readX12(text).segments[0] ?? [];

const file837 = build837(
  sampleSubmitter,
  [sampleX837, sampleRejectedX837, sampleDependentX837],
  sampleEnvelope
);

describe('respond', () => {
  const now = new Date('2026-11-03T15:00:00Z');
  const r = respond(file837, now);

  it('acknowledges the 837 group in a 999 sent back to the submitter', () => {
    assert.equal(r.error, null);
    assert.deepEqual(read999(r.ack999), [
      {
        groupControlNumber: '42',
        accepted: true,
        transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
      }
    ]);
    const isa = isaOf(r.ack999);
    assert.equal(isa[6]?.trim(), 'RCV01');
    assert.equal(isa[8]?.trim(), 'SUB01');
  });

  it('rejects claims whose member ID starts with REJECT in the 277CA', () => {
    assert.deepEqual(
      read277(r.ack277 ?? '').map((c) => [c.claimNumber, c.status, c.message]),
      [
        ['c-1', 'accepted', 'Accepted into adjudication'],
        ['c-2', 'rejected', 'Invalid member ID'],
        ['c-3', 'accepted', 'Accepted into adjudication']
      ]
    );
    assert.deepEqual(r.accepted, ['c-1', 'c-3']);
    assert.deepEqual(r.rejected, ['c-2']);
  });

  it('pays 80% of each accepted claim per payer and adjusts the rest as CO-45', () => {
    const remits = read835(r.remit835 ?? '');
    assert.deepEqual(
      remits.map((m) => [
        m.payerId,
        m.totalCents,
        m.claims.map((c) => [c.claimNumber, c.chargeCents, c.paidCents, c.payerClaimNumber])
      ]),
      [
        ['DEMOMCR', 75_400, [['c-1', 94_250, 75_400, 'MOCK-c-1']]],
        ['AETNA', 68_000, [['c-3', 85_000, 68_000, 'MOCK-c-3']]]
      ]
    );
    assert.deepEqual(remits[0]?.claims[0]?.adjustments, [
      { group: 'CO', reason: '45', cents: 18_850 }
    ]);
    assert.equal(remits[0]?.paidOn, '2026-11-03');
  });

  it('rounds the payment to cents', () => {
    const odd = build837(
      sampleSubmitter,
      [
        {
          ...sampleX837,
          lines: [{ ...sampleX837.lines[0], chargeCents: 12_345 } as X837Claim['lines'][number]]
        }
      ],
      sampleEnvelope
    );
    const [remit] = read835(respond(odd, now).remit835 ?? '');
    assert.equal(remit?.claims[0]?.paidCents, 9_876);
    assert.deepEqual(remit?.claims[0]?.adjustments, [{ group: 'CO', reason: '45', cents: 2_469 }]);
  });

  it('sends no 835 when every claim is rejected', () => {
    const all = respond(build837(sampleSubmitter, [sampleRejectedX837], sampleEnvelope), now);
    assert.equal(all.remit835, null);
    assert.equal(read277(all.ack277 ?? '')[0]?.status, 'rejected');
  });

  it('rejects the whole group with AK9*R when the file cannot be read', () => {
    const broken = file837.replace(/CLM\*[^~]*~\n?/g, '');
    const bad = respond(broken, now);
    assert.equal(bad.error, 'The 837 has no claims');
    assert.equal(bad.ack277, null);
    assert.equal(bad.remit835, null);
    assert.deepEqual(read999(bad.ack999), [
      {
        groupControlNumber: '42',
        accepted: false,
        transactions: [{ controlNumber: '0001', accepted: false, errors: [] }]
      }
    ]);
    assert.ok(bad.ack999.includes('AK9*R*1*1*0~'));
    const junk = respond('not x12 at all', now);
    assert.equal(read999(junk.ack999)[0]?.groupControlNumber, '0');
    assert.equal(read999(junk.ack999)[0]?.accepted, false);
  });
});
