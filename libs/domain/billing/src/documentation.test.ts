import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  daysBetween,
  pcsOnFileOf,
  poundsOf,
  readDocumentation,
  signatureOf
} from './documentation.ts';

const release = (status: string, signer = '4512015') => ({
  signer,
  reasons: ['4513001', '4513005'],
  status
});

describe('signatureOf', () => {
  it('reads the billing release, preferring a signature over an exception', () => {
    assert.deepEqual(signatureOf([release('4515023'), release('4515031')]), {
      signature: 'signed',
      signatureNote: null
    });
    assert.deepEqual(signatureOf([release('4515033', '4512017')]), {
      signature: 'signed',
      signatureNote: 'Signed by a patient representative'
    });
  });

  it('accepts only reasons a patient could not sign as exceptions', () => {
    assert.deepEqual(signatureOf([release('4515023')]), {
      signature: 'exception',
      signatureNote: 'Not signed because the patient was unconscious'
    });
    assert.equal(signatureOf([release('4515001')]).signature, 'missing');
    assert.match(signatureOf([release('4515001')]).signatureNote ?? '', /not a reason/);
    assert.equal(signatureOf([release('4515019')]).signature, 'refused');
    assert.deepEqual(signatureOf([release('4515027')]), {
      signature: 'signed',
      signatureNote: null
    });
    assert.deepEqual(signatureOf([release('4515015', '4512017')]), {
      signature: 'exception',
      signatureNote: 'Not signed because the patient is a minor'
    });
    assert.deepEqual(signatureOf([{ ...release(''), status: undefined }]), {
      signature: 'missing',
      signatureNote: 'The billing signature has no status'
    });
  });

  it('prefers an exception over a refusal, and a refusal over no signature', () => {
    assert.equal(signatureOf([release('4515001'), release('4515019')]).signature, 'refused');
    assert.equal(signatureOf([release('4515019'), release('4515003')]).signature, 'exception');
  });

  it('ignores signatures for anything but billing', () => {
    assert.equal(
      signatureOf([{ signer: '4512015', reasons: ['4513003'], status: '4515031' }]).signature,
      'missing'
    );
    assert.equal(signatureOf(null).signature, 'missing');
  });
});

describe('readDocumentation', () => {
  it('keeps only valid codes, dates, times and weights', () => {
    assert.deepEqual(
      readDocumentation({
        signature: 'signed',
        pcsOnFile: '9922005',
        pcsSignedOn: '2026-09-01T00:00:00Z',
        transportReason: 'd',
        conditionCodes: ['09', '06', '09', '99', '01', '04', '05', '07'],
        priorAuthorization: ' PA-1 ',
        weightKg: 81.6,
        atScene: 'not a time',
        leftScene: '2026-09-01T10:00:00Z',
        atDestination: null
      }),
      {
        signature: 'signed',
        signatureNote: null,
        pcsOnFile: true,
        pcsSignedOn: '2026-09-01',
        transportReason: 'D',
        conditionCodes: ['09', '06', '01', '04', '05'],
        priorAuthorization: 'PA-1',
        weightKg: 81.6,
        atScene: null,
        leftScene: '2026-09-01T10:00:00Z',
        atDestination: null
      }
    );
    assert.equal(readDocumentation({ signature: 'maybe', weightKg: -3 }).signature, 'missing');
    assert.equal(readDocumentation({ weightKg: -3 }).weightKg, null);
  });

  it('converts NEMSIS yes/no codes, weights and day spans', () => {
    assert.deepEqual(['9922005', '9922001', '9922003', false].map(pcsOnFileOf), [
      true,
      false,
      null,
      false
    ]);
    assert.equal(poundsOf(81.6), 180);
    assert.equal(poundsOf(null), null);
    assert.equal(daysBetween('2026-09-01', '2026-10-31T12:00:00Z'), 60);
    assert.equal(daysBetween('2026-10-03', '2026-10-01'), -2);
    assert.deepEqual([true, 'yes', undefined].map(pcsOnFileOf), [true, null, null]);
    assert.equal(readDocumentation({ weightKg: 1000 }).weightKg, null);
    assert.equal(readDocumentation({ transportReason: 'F' }).transportReason, null);
  });
});
