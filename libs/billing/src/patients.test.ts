import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { matchPatient, nameKey, type Patient, readDemographics, toNewPatient } from './patients.ts';

const address = {
  addressLine: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postalCode: '62704'
};

const jane: Patient = {
  id: 'p1',
  firstName: 'Jane',
  lastName: "O'Brien",
  birthDate: '1980-02-29',
  gender: 'F',
  ...address
};

const report = {
  firstName: 'Janet',
  lastName: 'OBRIEN',
  birthDate: '1980-02-29',
  gender: 'F' as const,
  ...address
};

describe('readDemographics', () => {
  it('keeps trimmed text, real birth dates, X12 sex codes and USPS addresses', () => {
    assert.deepEqual(
      readDemographics({
        ...report,
        firstName: '  Janet ',
        gender: '9919001',
        state: '17',
        postalCode: '62704-'
      }),
      report
    );
    assert.equal(readDemographics({ gender: '9906003' }).gender, 'M');
    assert.equal(readDemographics({ gender: 'other' }).gender, null);
    assert.equal(readDemographics({ postalCode: 7 }).postalCode, null);
    assert.equal(readDemographics({ city: '2395220' }).city, null);
    assert.equal(readDemographics({ birthDate: '1981-02-29' }).birthDate, null);
    assert.equal(readDemographics({ birthDate: '02/03/1980' }).birthDate, null);
    assert.deepEqual(readDemographics(null), {
      firstName: null,
      lastName: null,
      birthDate: null,
      gender: null,
      addressLine: null,
      city: null,
      state: null,
      postalCode: null
    });
  });

  it('builds new patients only from complete demographics', () => {
    assert.deepEqual(toNewPatient(readDemographics(report)), report);
    assert.equal(toNewPatient(readDemographics({ ...report, lastName: '--' })), null);
    assert.equal(toNewPatient(readDemographics({ ...report, birthDate: null })), null);
  });
});

describe('nameKey', () => {
  it('ignores case, accents, spaces and punctuation', () => {
    assert.equal(nameKey("O'Brien-Smith "), 'obriensmith');
    assert.equal(nameKey('José'), 'jose');
    assert.equal(nameKey('李'), '李');
  });
});

describe('matchPatient', () => {
  const d = readDemographics(report);

  it('matches one patient with the same last name, birth date and first initial', () => {
    const other = { ...jane, id: 'p2', firstName: 'Mary' };
    assert.deepEqual(matchPatient(d, [jane, other]), { kind: 'matched', patient: jane });
  });

  it('sends ambiguous and near matches to review', () => {
    const twin = { ...jane, id: 'p2', firstName: 'Joan' };
    assert.deepEqual(matchPatient(d, [jane, twin]), {
      kind: 'review',
      reason: 'Several patients share this name and birth date',
      candidates: [jane, twin]
    });
    const married = { ...jane, lastName: 'Smith', firstName: 'Janet' };
    const typo = { ...jane, birthDate: '1980-02-28', firstName: 'Janet' };
    const stranger = { ...jane, lastName: 'Smith', birthDate: '1970-01-01' };
    assert.deepEqual(matchPatient(d, [married, typo, stranger]), {
      kind: 'review',
      reason: 'Similar patients found',
      candidates: [married, typo]
    });
  });

  it('creates when nothing is close and reviews incomplete reports', () => {
    const stranger = { ...jane, firstName: 'Bob', lastName: 'Smith' };
    assert.deepEqual(matchPatient(d, [stranger]), { kind: 'unmatched' });
    assert.deepEqual(matchPatient(readDemographics({ ...report, birthDate: null }), [jane]), {
      kind: 'review',
      reason: 'The report is missing the first name, last name or birth date',
      candidates: []
    });
  });
});
