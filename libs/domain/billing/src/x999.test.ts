import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { read999 } from './x999.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'CLEARING'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261023*1410*^*00501*000000555*0*P*:~`;

const file = (...segments: string[]) =>
  `${ISA}GS*FA*CLEARING*METROEMS*20261023*1410*555*X*005010X231A1~${segments.map((s) => `${s}~`).join('')}GE*1*555~IEA*1*000000555~`;

const ack = (...body: string[]) =>
  read999(file('ST*999*0001*005010X231A1', ...body, `SE*${body.length + 2}*0001`));

const errorsOf = (...body: string[]) =>
  ack('AK1*HC*50', 'AK2*837*0001', ...body, 'IK5*R', 'AK9*R*1*1*0')[0]?.transactions[0]?.errors;

describe('read999 acceptance', () => {
  it('accepts a group whose transactions passed', () => {
    assert.deepEqual(
      ack('AK1*HC*42*005010X222A1', 'AK2*837*0001*005010X222A1', 'IK5*A', 'AK9*A*1*1*1'),
      [
        {
          groupControlNumber: '42',
          accepted: true,
          transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
        }
      ]
    );
  });

  it('accepts a transaction and a group accepted with errors', () => {
    assert.deepEqual(
      ack(
        'AK1*HC*45*005010X222A1',
        'AK2*837*0001*005010X222A1',
        'IK3*REF*12**I4',
        'IK4*2**I12',
        'IK5*E*I5',
        'AK9*E*1*1*1'
      ),
      [
        {
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
        }
      ]
    );
  });

  it('rejects a group only partly accepted while keeping its accepted transactions', () => {
    assert.deepEqual(
      ack('AK1*HC*43', 'AK2*837*0001', 'IK5*R*5', 'AK2*837*0002', 'IK5*A', 'AK9*P*2*2*1'),
      [
        {
          groupControlNumber: '43',
          accepted: false,
          transactions: [
            { controlNumber: '0001', accepted: false, errors: [] },
            { controlNumber: '0002', accepted: true, errors: [] }
          ]
        }
      ]
    );
  });

  it('rejects a transaction with an unknown acknowledgment code', () => {
    assert.deepEqual(ack('AK1*HC*44', 'AK2*837*0001', 'IK5*X', 'AK9*X*1*1*0')[0], {
      groupControlNumber: '44',
      accepted: false,
      transactions: [{ controlNumber: '0001', accepted: false, errors: [] }]
    });
  });

  it('trims control numbers', () => {
    assert.deepEqual(ack('AK1*HC* 46 ', 'AK2*837* 0001 ', 'IK5*A', 'AK9*A')[0], {
      groupControlNumber: '46',
      accepted: true,
      transactions: [{ controlNumber: '0001', accepted: true, errors: [] }]
    });
  });
});

describe('read999 errors', () => {
  it('describes segment errors with their position and loop', () => {
    assert.deepEqual(errorsOf('IK3*NM1*19*2010BA*8', 'IK3*DMG*21**3'), [
      'Segment NM1 at position 19 in loop 2010BA: Segment has data element errors',
      'Segment DMG at position 21: Required segment missing'
    ]);
  });

  it('describes element errors with their component, reference and bad value', () => {
    assert.deepEqual(errorsOf('IK4*9**7*ZZ', 'IK4*2:1*1251*8*20261399', 'IK4*7:3**6* '), [
      'Element 9: Invalid code value "ZZ"',
      'Element 2-1 (1251): Invalid date "20261399"',
      'Element 7-3: Invalid character in data element'
    ]);
  });

  it('describes the context of an error by name and value', () => {
    assert.deepEqual(errorsOf('CTX*CLM01:1001', 'CTX*SITUATIONAL TRIGGER'), [
      'Context CLM01 1001',
      'Context SITUATIONAL TRIGGER'
    ]);
  });

  it('describes codes it does not know by their number', () => {
    assert.deepEqual(errorsOf('IK3*CLM*5**Q9', 'IK4*3**Z1'), [
      'Segment CLM at position 5: Error Q9',
      'Element 3: Error Z1'
    ]);
  });

  it('marks a missing segment, position or code', () => {
    assert.deepEqual(errorsOf('IK3', 'IK3***', 'IK4***7', 'IK4'), [
      'Segment ? at position ?: Error without a code',
      'Segment ? at position ?: Error without a code',
      'Element ?: Invalid code value',
      'Element ?: Error without a code'
    ]);
  });

  it('keeps errors in the order they appear', () => {
    assert.deepEqual(errorsOf('IK3*NM1*19*2010BA*8', 'CTX*CLM01:1001', 'IK4*9**7*ZZ'), [
      'Segment NM1 at position 19 in loop 2010BA: Segment has data element errors',
      'Context CLM01 1001',
      'Element 9: Invalid code value "ZZ"'
    ]);
  });
});

describe('read999 structure', () => {
  it('ignores answers and errors outside a group or after a transaction closes', () => {
    assert.deepEqual(
      ack('IK5*A', 'AK9*A', 'AK2*837', 'AK1*HC', 'AK2*837', 'IK3', 'IK5', 'IK4*1**1', 'AK9'),
      [
        {
          groupControlNumber: '',
          accepted: false,
          transactions: [
            {
              controlNumber: '',
              accepted: false,
              errors: ['Segment ? at position ?: Error without a code']
            }
          ]
        }
      ]
    );
  });

  it('ignores errors before any transaction of a group', () => {
    assert.deepEqual(ack('AK1*HC*46', 'IK3*CLM*5**8', 'AK9*R*1*0*0'), [
      { groupControlNumber: '46', accepted: false, transactions: [] }
    ]);
  });

  it('reads every group of every 999 transaction and skips other transaction sets', () => {
    assert.deepEqual(
      read999(
        file(
          'ST*999*0001*005010X231A1',
          'AK1*HC*46',
          'AK9*A',
          'AK1*HC*47',
          'AK9*R',
          'SE*6*0001',
          'ST*277*0002',
          'AK1*HC*48',
          'SE*3*0002',
          'ST*999*0003*005010X231A1',
          'AK1*HC*49',
          'AK9*A',
          'SE*4*0003'
        )
      ),
      [
        { groupControlNumber: '46', accepted: true, transactions: [] },
        { groupControlNumber: '47', accepted: false, transactions: [] },
        { groupControlNumber: '49', accepted: true, transactions: [] }
      ]
    );
  });
});
