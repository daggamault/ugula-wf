import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { build271, build277, build835, build999, read837, respond } from './mock-x12.ts';
import { sampleSubmitter, sampleX837 } from './testing.ts';
import { readX12 } from './x12.ts';
import { read277 } from './x277.ts';
import { read835 } from './x835.ts';
import { build837, type X837Claim } from './x837.ts';
import { read999 } from './x999.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

const isaOf = (text: string) => readX12(text).segments[0] ?? [];

describe('mock builders round-trip through our readers', () => {
  it('builds a 999 that accepts or rejects a group', () => {
    assert.deepEqual(
      read999(
        build999(
          { groupControlNumber: '42', transactions: [{ controlNumber: '0001', accepted: true }] },
          at
        )
      ),
      [
        {
          groupControlNumber: '42',
          accepted: true,
          transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
        }
      ]
    );
    const [rejected] = read999(
      build999(
        {
          groupControlNumber: '43',
          transactions: [
            {
              controlNumber: '0001',
              accepted: false,
              errors: [
                {
                  segment: 'NM1',
                  position: 12,
                  loop: '2010',
                  code: '8',
                  element: { position: '9', code: '7' }
                }
              ]
            }
          ]
        },
        at
      )
    );
    assert.equal(rejected?.accepted, false);
    assert.deepEqual(rejected?.transactions[0]?.errors, [
      'Segment NM1 at position 12 in loop 2010: Segment has data element errors',
      'Element 9: Invalid code value'
    ]);
  });

  it('builds a 277CA with one status per claim', () => {
    const text = build277(
      {
        claims: [
          { claimNumber: '101', chargeCents: 1000, rejection: null, payerClaimNumber: 'P-1' },
          { claimNumber: '102', rejection: 'Invalid member ID' }
        ]
      },
      at
    );
    assert.deepEqual(read277(text), [
      {
        claimNumber: '101',
        status: 'accepted',
        categories: ['A2'],
        payerClaimNumber: 'P-1',
        message: 'Accepted into adjudication'
      },
      {
        claimNumber: '102',
        status: 'rejected',
        categories: ['A7'],
        payerClaimNumber: null,
        message: 'Invalid member ID'
      }
    ]);
  });

  it('builds an 835 with one transaction per payer', () => {
    const text = build835(
      [
        {
          payer: { name: 'Medicare', id: 'MCR' },
          claims: [
            { claimNumber: '101', chargeCents: 10_000, paidCents: 8_000, payerClaimNumber: 'P-1' },
            { claimNumber: '102', chargeCents: 5_000, paidCents: 4_000 }
          ]
        },
        {
          payer: { name: 'Aetna', id: 'AET' },
          checkNumber: 'CHK-9',
          claims: [{ claimNumber: '103', chargeCents: 2_000, paidCents: 0 }]
        }
      ],
      at
    );
    const [mcr, aet] = read835(text);
    assert.equal(mcr?.payerId, 'MCR');
    assert.equal(mcr?.totalCents, 12_000);
    assert.equal(mcr?.paidOn, '2026-11-03');
    assert.deepEqual(
      mcr?.claims.map((c) => [c.claimNumber, c.chargeCents, c.paidCents, c.payerClaimNumber]),
      [
        ['101', 10_000, 8_000, 'P-1'],
        ['102', 5_000, 4_000, null]
      ]
    );
    assert.deepEqual(mcr?.claims[0]?.adjustments, [{ group: 'CO', reason: '45', cents: 2_000 }]);
    assert.equal(aet?.payerId, 'AET');
    assert.equal(aet?.checkNumber, 'CHK-9');
    assert.equal(aet?.claims[0]?.denied, true);
  });

  it('builds a 271 and a well-formed envelope', () => {
    const text = build271({ trace: 'T-1', active: true }, { ...at, sender: 'CH', receiver: 'ME' });
    const file = readX12(text);
    assert.equal(file.kind, '271');
    assert.equal(file.controlNumber, '000000007');
    const isa = isaOf(text);
    assert.equal(`${isa.join('*')}~`.length, 106);
    assert.equal(isa[6]?.trim(), 'CH');
    assert.equal(isa[8]?.trim(), 'ME');
    const se = file.segments.find((s) => s[0] === 'SE');
    const st = file.segments.findIndex((s) => s[0] === 'ST');
    const seAt = file.segments.findIndex((s) => s[0] === 'SE');
    assert.equal(se?.[1], String(seAt - st + 1));
    assert.deepEqual(file.segments.at(-2), ['GE', '1', '7']);
  });
});

const envelope = { controlNumber: 42, createdAt: new Date('2026-10-23T14:05:09Z') };

const rejected: X837Claim = {
  ...sampleX837,
  claimId: 'c-2',
  subscriber: { ...sampleX837.subscriber, memberId: 'REJECT123' }
};

const dependent: X837Claim = {
  ...sampleX837,
  claimId: 'c-3',
  subscriber: {
    relationship: '01',
    lastName: 'Smith',
    firstName: 'Ann',
    memberId: 'SPOUSE1',
    groupId: null
  },
  payer: { name: 'Aetna', payerId: 'AETNA', claimFiling: 'CI', insuranceType: null },
  otherPayers: [
    {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: 'OTHER-MEMBER',
      groupId: null,
      relationship: '18',
      lastName: 'Smith',
      firstName: 'Bob',
      paidCents: 10_000,
      adjustedCents: 0,
      adjustments: [],
      paidOn: '2026-10-10'
    }
  ],
  lines: [{ ...sampleX837.lines[0], serviceDate: '2026-10-02' } as X837Claim['lines'][number]]
};

const file837 = build837(sampleSubmitter, [sampleX837, rejected, dependent], envelope);

describe('read837', () => {
  it('reads the envelope and each claim of our own 837P', () => {
    const r = read837(file837);
    assert.equal(r.interchangeControlNumber, '000000042');
    assert.equal(r.groupControlNumber, '42');
    assert.equal(r.transactionControlNumber, '0001');
    assert.equal(r.sender, 'SUB01');
    assert.equal(r.receiver, 'RCV01');
    assert.deepEqual(r.provider, { name: 'METRO EMS', id: '1234567893' });
    assert.deepEqual(
      r.claims.map((c) => [c.claimNumber, c.chargeCents, c.memberId, c.serviceDate, c.payer?.id]),
      [
        ['c-1', 94_250, '1EG4TE5MK73', '2026-10-01', 'DEMOMCR'],
        ['c-2', 94_250, 'REJECT123', '2026-10-01', 'DEMOMCR'],
        ['c-3', 85_000, 'SPOUSE1', '2026-10-02', 'AETNA']
      ]
    );
    assert.equal(r.claims[2]?.claimFiling, 'CI');
    assert.equal(r.claims[2]?.patient.lastName, "O'BRIEN");
  });

  it('refuses what is not an 837P', () => {
    assert.throws(() => read837('hello'), /Not an X12 file/);
    assert.throws(() => read837(build999({ groupControlNumber: '1', transactions: [] }, at)));
  });
});

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
      envelope
    );
    const [remit] = read835(respond(odd, now).remit835 ?? '');
    assert.equal(remit?.claims[0]?.paidCents, 9_876);
    assert.deepEqual(remit?.claims[0]?.adjustments, [{ group: 'CO', reason: '45', cents: 2_469 }]);
  });

  it('sends no 835 when every claim is rejected', () => {
    const all = respond(build837(sampleSubmitter, [rejected], envelope), now);
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
