import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { envelope, mockDollars, randomControl, stamp } from './mock-envelope.ts';
import { MAX_CONTROL_NUMBER, readX12 } from './x12.ts';

const at = { createdAt: new Date('2026-11-03T12:34:00Z'), controlNumber: 7 };

const body = [
  { id: '271', version: '005010X279A1', body: [['BHT', '0022', '11', 'O~B*R:N^']] },
  { id: '271', version: '005010X279A1', body: [] }
];

describe('envelope', () => {
  it('wraps transactions in a fixed-width ISA, GS, ST/SE pairs, GE and IEA', () => {
    const text = envelope(
      { ...at, sender: 'CH', receiver: 'ME' },
      { functional: 'HB', version: '005010X279A1' },
      body
    );
    const file = readX12(text);
    const [isa = []] = file.segments;
    assert.equal(`${isa.join('*')}~`.length, 106);
    assert.equal(isa[6]?.trim(), 'CH');
    assert.equal(isa[8]?.trim(), 'ME');
    assert.equal(isa[9], '261103');
    assert.equal(isa[10], '1234');
    assert.equal(isa[13], '000000007');
    assert.equal(isa[15], 'T');
    assert.deepEqual(
      file.segments.filter((s) => s[0] === 'ST' || s[0] === 'SE'),
      [
        ['ST', '271', '0001', '005010X279A1'],
        ['SE', '3', '0001'],
        ['ST', '271', '0002', '005010X279A1'],
        ['SE', '2', '0002']
      ]
    );
    assert.deepEqual(file.segments.at(-2), ['GE', '2', '7']);
    assert.deepEqual(file.segments.at(-1), ['IEA', '1', '000000007']);
  });

  it('strips delimiters and non-printable characters from values', () => {
    const text = envelope(at, { functional: 'HB', version: '005010X279A1' }, body);
    assert.ok(text.includes('BHT*0022*11*O B R N ~'));
  });

  it('marks production files and refuses control numbers out of range', () => {
    const text = envelope({ ...at, production: true }, { functional: 'FA', version: 'V' }, []);
    assert.equal(readX12(text).segments[0]?.[15], 'P');
    for (const controlNumber of [0, 1.5, MAX_CONTROL_NUMBER + 1]) {
      assert.throws(
        () => envelope({ controlNumber }, { functional: 'FA', version: 'V' }, []),
        /out of range/
      );
    }
  });
});

describe('envelope helpers', () => {
  it('formats cents, stamps dates and draws control numbers in range', () => {
    assert.equal(mockDollars(12_345), '123.45');
    assert.deepEqual(stamp(at), { date: '20261103', time: '1234' });
    const n = randomControl();
    assert.ok(Number.isInteger(n) && n >= 1 && n < MAX_CONTROL_NUMBER);
  });
});
