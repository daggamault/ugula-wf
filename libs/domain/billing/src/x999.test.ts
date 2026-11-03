import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read999 } from './x999.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261023*1410*^*00501*000000555*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}GS*FA*CLEARING*METROEMS*20261023*1410*555*X*005010X231A1~${segments.map((s) => `${s}~`).join('')}GE*1*555~IEA*1*000000555~`;

describe('read999', () => {
  it('accepts a group whose transactions passed', () => {
    assert.deepEqual(
      read999(
        file(
          'ST*999*0001*005010X231A1',
          'AK1*HC*42*005010X222A1',
          'AK2*837*0001*005010X222A1',
          'IK5*A',
          'AK9*A*1*1*1',
          'SE*6*0001'
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
  });

  it('rejects transactions with readable segment and element errors', () => {
    const [group] = read999(
      file(
        'ST*999*0001*005010X231A1',
        'AK1*HC*43*005010X222A1',
        'AK2*837*0001*005010X222A1',
        'IK3*NM1*19*2010BA*8',
        'CTX*CLM01:1001',
        'IK4*9**7*ZZ',
        'IK3*DMG*21**3',
        'IK4*2:1*1251*8*20261399',
        'IK5*R*5',
        'AK2*837*0002*005010X222A1',
        'IK5*E',
        'AK9*P*2*2*1',
        'SE*13*0001'
      )
    );
    assert.equal(group?.accepted, false);
    assert.deepEqual(group?.transactions, [
      {
        controlNumber: '0001',
        accepted: false,
        errors: [
          'Segment NM1 at position 19 in loop 2010BA: Segment has data element errors',
          'Context CLM01 1001',
          'Element 9: Invalid code value "ZZ"',
          'Segment DMG at position 21: Required segment missing',
          'Element 2-1 (1251): Invalid date "20261399"'
        ]
      },
      { controlNumber: '0002', accepted: true, errors: [] }
    ]);
  });

  it('describes codes it does not know by their number', () => {
    const [group] = read999(
      file(
        'ST*999*0001*005010X231A1',
        'AK1*HC*44',
        'AK2*837*0001',
        'IK3*CLM*5**Q9',
        'IK5*X',
        'AK9*R*1*1*0',
        'SE*7*0001'
      )
    );
    assert.deepEqual(group?.transactions[0]?.errors, ['Segment CLM at position 5: Error Q9']);
    assert.equal(group?.transactions[0]?.accepted, false);
  });

  it('accepts a group accepted with errors, and rejects one only partly accepted', () => {
    const ack = (ak9: string) =>
      read999(
        file(
          'ST*999*0001*005010X231A1',
          'AK1*HC*45*005010X222A1',
          'AK2*837*0001*005010X222A1',
          'IK3*REF*12**I4',
          'IK4*2**I12',
          'IK5*E*I5',
          ak9,
          'SE*8*0001'
        )
      )[0];
    assert.deepEqual(ack('AK9*E*1*1*1'), {
      groupControlNumber: '45',
      accepted: true,
      transactions: [
        {
          controlNumber: '0001',
          accepted: true,
          errors: [
            'Segment REF at position 12: Segment the implementation does not use is present',
            'Element 2: Implementation pattern match failure'
          ]
        }
      ]
    });
    assert.equal(ack('AK9*P*2*2*1')?.accepted, false);
  });

  it('ignores errors outside a transaction and reads only 999 transactions', () => {
    assert.deepEqual(
      read999(
        file(
          'ST*999*0001*005010X231A1',
          'AK1*HC*46',
          'IK3*CLM*5**8',
          'AK9*R*1*0*0',
          'SE*5*0001',
          'ST*277*0002',
          'AK1*HC*47',
          'SE*3*0002'
        )
      ),
      [{ groupControlNumber: '46', accepted: false, transactions: [] }]
    );
  });
});
