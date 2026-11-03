import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  centsOf,
  componentsOf,
  dateOf,
  interchange,
  readX12,
  stampOf,
  transactionsOf
} from './x12.ts';

const isa = (sep = '*', component = ':', end = '~') =>
  [
    'ISA',
    '00',
    ' '.repeat(10),
    '00',
    ' '.repeat(10),
    'ZZ',
    'PAYER'.padEnd(15),
    'ZZ',
    'AGENCY'.padEnd(15),
    '261023',
    '1405',
    '^',
    '00501',
    '000000042',
    '0',
    'P',
    component
  ].join(sep) + end;

describe('readX12', () => {
  it('reads delimiters from the ISA, tolerating line breaks around segments', () => {
    const file = readX12(
      `\r\n${isa('|', '>', '~')}\r\nGS|HP|PAYER|AGENCY~\r\nST|835|0001~\r\nSVC|HC>A0427|100~\r\nSE|3|0001~\r\nGE|1|1~\r\nIEA|1|000000042~\r\n`
    );
    assert.equal(file.kind, '835');
    assert.equal(file.controlNumber, '000000042');
    assert.equal(file.component, '>');
    assert.deepEqual(file.segments[3], ['SVC', 'HC>A0427', '100']);
    assert.deepEqual(componentsOf(file.segments[3]?.[1], file), ['HC', 'A0427']);
    assert.deepEqual(componentsOf(undefined, file), ['']);
  });

  it('knows only inbound kinds and rejects text that is not X12', () => {
    assert.equal(readX12(`${isa()}ST*837*0001~SE*2*0001~`).kind, null);
    assert.throws(() => readX12('hello'), /Not an X12 file/);
    assert.throws(() => readX12('ISA*00'), /Not an X12 file/);
  });

  it('splits transaction sets of one kind', () => {
    const file = readX12(`${isa()}ST*999*1~AK1*HC*1~SE*3*1~ST*835*2~BPR*I~SE*3*2~ST*999*3~SE*2*3~`);
    assert.deepEqual(
      transactionsOf(file, '999').map((t) => t.map((s) => s[0])),
      [
        ['ST', 'AK1', 'SE'],
        ['ST', 'SE']
      ]
    );
  });
});

describe('values', () => {
  it('reads dollars as cents and dates as ISO', () => {
    assert.deepEqual(
      ['942.5', '-12.345', '0.1', '', undefined, 'x'].map(centsOf),
      [94_250, -1235, 10, 0, 0, 0]
    );
    assert.equal(dateOf('20261031'), '2026-10-31');
    assert.equal(dateOf('261031'), null);
    assert.equal(dateOf(undefined), null);
  });
});

describe('interchange', () => {
  it('wraps a transaction in ISA, GS, SE, GE and IEA with its control numbers', () => {
    const text = interchange(
      { sender: 'agency 1', receiver: 'CLEARING', production: false },
      { controlNumber: 7, createdAt: new Date('2026-10-23T14:05:09Z') },
      { functional: 'HS', version: '005010X279A1' },
      [
        ['ST', '270', '0001', '005010X279A1'],
        ['EQ', '30']
      ]
    );
    const lines = text.trim().split('\n');
    assert.equal(lines[0]?.length, 106);
    assert.equal(
      lines[0]?.slice(0, 54),
      `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*AGENCY 1       *ZZ*`
    );
    assert.ok(lines[0]?.endsWith('*261023*1405*^*00501*000000007*0*T*:~'));
    assert.deepEqual(lines.slice(1), [
      'GS*HS*AGENCY 1*CLEARING*20261023*1405*7*X*005010X279A1~',
      'ST*270*0001*005010X279A1~',
      'EQ*30~',
      'SE*3*0001~',
      'GE*1*7~',
      'IEA*1*000000007~'
    ]);
    assert.deepEqual(stampOf({ controlNumber: 7, createdAt: new Date('2026-10-23T14:05:09Z') }), {
      date: '20261023',
      time: '1405',
      control: '000000007'
    });
    assert.throws(() => stampOf({ controlNumber: 0, createdAt: new Date() }), /out of range/);
  });
});
