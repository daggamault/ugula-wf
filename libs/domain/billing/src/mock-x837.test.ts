import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read837 } from './mock-x837.ts';
import { build999 } from './mock-x999.ts';
import {
  sampleDependentX837,
  sampleEnvelope,
  sampleRejectedX837,
  sampleSubmitter,
  sampleX837
} from './testing.ts';
import { build837 } from './x837.ts';

const at = { createdAt: new Date('2026-11-03T12:00:00Z'), controlNumber: 7 };

const isa = (usage: string) =>
  `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'SUB01'.padEnd(15)}*ZZ*${'RCV01'.padEnd(15)}*261103*1200*^*00501*000000009*0*${usage}*:~`;

const x837 = (body: string, usage = 'T') =>
  `${isa(usage)}GS*HC*SUB01*RCV01*20261103*1200*9*X*005010X222A1~ST*837*0009~${body}SE*2*0009~GE*1*9~IEA*1*000000009~`;

const file837 = build837(
  sampleSubmitter,
  [sampleX837, sampleRejectedX837, sampleDependentX837],
  sampleEnvelope
);

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
    assert.deepEqual(r.claims[0]?.lines, [
      { code: 'A0427', modifiers: ['RH'], chargeCents: 85_000, units: 1, lineNumber: '1' },
      { code: 'A0425', modifiers: ['RH'], chargeCents: 9_250, units: 7.4, lineNumber: '2' }
    ]);
  });

  it('starts each subscriber afresh, keeps the first service date and defaults lines', () => {
    const r = read837(
      x837(
        [
          'NM1*41*2*METRO EMS*****46*SUB01~',
          'HL*1**20*1~',
          'NM1*85*2*METRO EMS*****XX*1234567893~',
          'HL*2*1*22*1~',
          'SBR*P*18*******MB~',
          'NM1*IL*1*DOE*JANE****MI*M1~',
          'NM1*PR*2*MEDICARE*****PI*MCR~',
          'HL*3*2*23*0~',
          'NM1*QC*1*DOE*TIM~',
          'CLM*d-1*100***41:B:1~',
          'DTP*472*D8*20261001~',
          'DTP*472*D8*20261005~',
          'SV1*HC:A0427*100*UN~',
          'HL*4*1*22*0~',
          'NM1*IL*1*ROE*RAY~',
          'CLM*d-2*50.5~',
          'SV1*HC:A0425:RH:QL*50.5*UN*3~',
          'REF*6R*7~'
        ].join(''),
        'P'
      )
    );
    assert.equal(r.production, true);
    assert.equal(r.version, '005010X222A1');
    assert.deepEqual(r.submitter, { name: 'METRO EMS', id: 'SUB01' });
    assert.deepEqual(r.claims, [
      {
        claimNumber: 'd-1',
        chargeCents: 10_000,
        memberId: 'M1',
        serviceDate: '2026-10-01',
        patient: { lastName: 'DOE', firstName: 'TIM' },
        payer: { name: 'MEDICARE', id: 'MCR' },
        claimFiling: 'MB',
        lines: [{ code: 'A0427', modifiers: [], chargeCents: 10_000, units: 1, lineNumber: null }]
      },
      {
        claimNumber: 'd-2',
        chargeCents: 5_050,
        memberId: null,
        serviceDate: null,
        patient: { lastName: 'ROE', firstName: 'RAY' },
        payer: null,
        claimFiling: null,
        lines: [
          { code: 'A0425', modifiers: ['RH', 'QL'], chargeCents: 5_050, units: 3, lineNumber: '7' }
        ]
      }
    ]);
  });

  it('refuses what is not an 837P', () => {
    assert.throws(() => read837('hello'), /Not an X12 file/);
    assert.throws(
      () => read837(build999({ groupControlNumber: '1', transactions: [] }, at)),
      /No HC functional group/
    );
    assert.throws(() => read837(x837('').replace('ST*837*', 'ST*999*')), /No 837 transaction set/);
  });

  it('refuses a claim without a number and a file without claims', () => {
    assert.throws(() => read837(x837('CLM**100~')), /A CLM has no claim number/);
    assert.throws(() => read837(x837('HL*1**20*1~')), /The 837 has no claims/);
  });
});
