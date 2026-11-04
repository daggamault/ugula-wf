import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readTA1 } from './ta1.ts';

const ISA = `ISA*00*${' '.repeat(10)}*00*${' '.repeat(10)}*ZZ*${'WAYSTAR'.padEnd(15)}*ZZ*${'METROEMS'.padEnd(15)}*261104*1530*^*00501*000000042*0*T*:~`;

describe('readTA1', () => {
  it('reads whether each interchange was accepted and why it was not', () => {
    assert.deepEqual(
      readTA1(
        `${ISA}\nTA1*000000042*261104*1530*R*008~\nTA1*000000043*261104*1530*A*000~\nTA1*000000044*261104*1530*E*025~\nIEA*0*000000042~`
      ),
      [
        {
          controlNumber: '000000042',
          status: 'rejected',
          noteCode: '008',
          message: 'Invalid interchange receiver ID'
        },
        { controlNumber: '000000043', status: 'accepted', noteCode: '000', message: 'No error' },
        {
          controlNumber: '000000044',
          status: 'acceptedWithErrors',
          noteCode: '025',
          message: 'Duplicate interchange control number'
        }
      ]
    );
  });

  it('treats an unknown status as a rejection and names an unknown note', () => {
    assert.deepEqual(readTA1(`${ISA}TA1*000000042*261104*1530*X~IEA*0*000000042~`), [
      {
        controlNumber: '000000042',
        status: 'rejected',
        noteCode: '',
        message: 'Interchange note not given'
      }
    ]);
    assert.deepEqual(readTA1(`${ISA}IEA*0*000000042~`), []);
  });
});
