import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  isCompleteAddress,
  matchPatient,
  type Patient,
  readDemographics,
  sameAddress,
  sexOf,
  toNewPatient
} from './patients.ts';

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
    assert.deepEqual(['9919005', '9906005', '9906007', '9906011', 'f'].map(sexOf), [
      'U',
      'U',
      null,
      null,
      'F'
    ]);
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

describe('matchPatient', () => {
  const d = readDemographics(report);
  const janet = { ...jane, id: 'p0', firstName: 'Janet' };

  it('matches the one patient with the same last name, birth date and first name or nickname', () => {
    const other = { ...jane, id: 'p2', firstName: 'Mary' };
    assert.deepEqual(matchPatient(d, [janet, other]), { kind: 'matched', patient: janet });
    const bill = { ...jane, id: 'p3', firstName: 'William', gender: 'M' as const };
    assert.deepEqual(
      matchPatient(readDemographics({ ...report, firstName: 'Bill', gender: 'M' }), [bill]),
      {
        kind: 'matched',
        patient: bill
      }
    );
  });

  it('never merges on a first initial, a similar first name or a different sex', () => {
    const initial = readDemographics({ ...report, firstName: 'J' });
    assert.deepEqual(matchPatient(initial, [janet]), {
      kind: 'review',
      reason: 'Similar patients found',
      candidates: [janet]
    });
    assert.deepEqual(matchPatient(d, [jane]), {
      kind: 'review',
      reason: 'Similar patients found',
      candidates: [jane]
    });
    const brother = { ...janet, gender: 'M' as const };
    assert.equal(matchPatient(d, [brother]).kind, 'review');
    assert.equal(
      matchPatient(readDemographics({ ...report, gender: 'U' }), [janet]).kind,
      'matched'
    );
  });

  it('reviews several exact matches together', () => {
    const twin = { ...janet, id: 'p2' };
    assert.deepEqual(matchPatient(d, [janet, twin]), {
      kind: 'review',
      reason: 'Several patients share this name and birth date',
      candidates: [janet, twin]
    });
  });

  it('finds the same person through name and birth date typos, closest first', () => {
    const married = { ...janet, id: 'm', lastName: 'Smith' };
    const misspelled = { ...janet, id: 's', lastName: "O'Brian" };
    const swapped = { ...janet, id: 'w', birthDate: '1980-29-02' };
    const digit = { ...janet, id: 'g', birthDate: '1981-02-29' };
    const transposed = { ...janet, id: 't', birthDate: '1980-02-92' };
    const both = { ...janet, id: 'b', lastName: 'Obrein', birthDate: '1980-02-28' };
    const stranger = {
      ...janet,
      id: 'x',
      lastName: 'Smith',
      firstName: 'Bob',
      birthDate: '1970-01-01'
    };
    const decision = matchPatient(d, [
      stranger,
      both,
      married,
      swapped,
      digit,
      transposed,
      misspelled
    ]);
    assert.equal(decision.kind, 'review');
    assert.deepEqual(decision.kind === 'review' && decision.candidates.map((c) => c.id), [
      's',
      'm',
      'w',
      'g',
      't',
      'b'
    ]);
  });

  it('creates when nothing is close and flags incomplete reports', () => {
    const stranger = { ...jane, firstName: 'Bob', lastName: 'Smith' };
    assert.deepEqual(matchPatient(d, [stranger]), { kind: 'unmatched' });
    const farOff = { ...janet, birthDate: '1955-07-04' };
    assert.deepEqual(matchPatient(d, [farOff]), { kind: 'unmatched' });
    assert.deepEqual(matchPatient(readDemographics({ ...report, birthDate: null }), [janet]), {
      kind: 'incomplete'
    });
  });
});

describe('addresses', () => {
  const home = { addressLine: '2 Elm St', city: 'Springfield', state: 'IL', postalCode: '62701' };

  it('knows a complete mailing address, and the same one written differently', () => {
    assert.ok(isCompleteAddress(home));
    assert.ok(!isCompleteAddress({ ...home, state: null }));
    assert.ok(sameAddress(home, { ...home, addressLine: '2 ELM ST.', postalCode: '627011234' }));
    assert.ok(!sameAddress(home, { ...home, addressLine: '3 Elm St' }));
  });
});
