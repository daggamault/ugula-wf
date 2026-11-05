import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { codeSystemOf, describeCode, reportTerms } from './dictionary.ts';

describe('reportTerms', () => {
  it('collects element names and coded values, including attributes, once each', () => {
    const terms = reportTerms({
      eResponse: { 'eResponse.05': '2205001' },
      eVitals: {
        'eVitals.VitalGroup': [{ 'eVitals.06': '120' }, { 'eVitals.06': '120' }]
      },
      eSituation: { 'eSituation.11': { '#text': 'R07.9', '@PN': '8801005' } },
      eNarrative: { 'eNarrative.01': 'Pt found supine, alert and oriented.' }
    });
    assert.deepEqual(terms.elements, [
      'eNarrative',
      'eNarrative.01',
      'eResponse',
      'eResponse.05',
      'eSituation',
      'eSituation.11',
      'eVitals',
      'eVitals.06',
      'eVitals.VitalGroup'
    ]);
    assert.deepEqual(terms.codes, [
      { list: 'eResponse.05', code: '2205001' },
      { list: 'eVitals.06', code: '120' },
      { list: 'eSituation.11', code: 'R07.9' },
      { list: '@PN', code: '8801005' }
    ]);
  });

  it('finds nothing in a report that is not an object', () => {
    assert.deepEqual(reportTerms(null), { elements: [], codes: [] });
  });
});

describe('codeSystemOf', () => {
  it('names the outside code system of elements NEMSIS does not enumerate', () => {
    assert.equal(codeSystemOf('eSituation.11'), 'icd10');
    assert.equal(codeSystemOf('eMedications.03'), 'rxnorm');
    assert.equal(codeSystemOf('eProcedures.03'), 'snomed');
    assert.equal(codeSystemOf('eDisposition.04'), 'gnis');
    assert.equal(codeSystemOf('ePatient.08'), 'state');
    assert.equal(codeSystemOf('eResponse.05'), null);
    assert.equal(codeSystemOf('toString'), null);
  });
});

describe('describeCode', () => {
  it('describes element and attribute codes and returns null for unknown ones', () => {
    const dictionary = {
      elements: {},
      codes: { 'eResponse.05': { '2205001': 'Emergency' }, '@NV': { '7701003': 'Not Recorded' } }
    };
    assert.equal(describeCode(dictionary, 'eResponse.05', '2205001'), 'Emergency');
    assert.equal(describeCode(dictionary, '@NV', '7701003'), 'Not Recorded');
    assert.equal(describeCode(dictionary, 'eResponse.05', '1'), null);
  });
});
