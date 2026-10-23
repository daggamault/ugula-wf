import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { usState, zipCode } from './geo.ts';

describe('usState', () => {
  it('turns NEMSIS ANSI (FIPS) state codes and USPS codes into USPS abbreviations', () => {
    assert.equal(usState('17'), 'IL');
    assert.equal(usState('6'), 'CA');
    assert.equal(usState(' il '), 'IL');
    assert.equal(usState('72'), 'PR');
    assert.equal(usState('03'), null);
    assert.equal(usState('ZZ'), null);
    assert.equal(usState(17), null);
  });
});

describe('zipCode', () => {
  it('keeps 5 or 9 digit ZIP codes without punctuation', () => {
    assert.equal(zipCode('62704'), '62704');
    assert.equal(zipCode('62704-1234'), '627041234');
    assert.equal(zipCode('6270'), null);
    assert.equal(zipCode(null), null);
  });
});
