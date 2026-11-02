import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { attributeList, describeCode, reportTerms } from './dictionary.ts';

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

describe('describeCode', () => {
  it('describes element and attribute codes and returns null for unknown ones', () => {
    const dictionary = {
      elements: {},
      codes: { 'eResponse.05': { '2205001': 'Emergency' }, '@NV': { '7701003': 'Not Recorded' } }
    };
    assert.equal(describeCode(dictionary, 'eResponse.05', '2205001'), 'Emergency');
    assert.equal(describeCode(dictionary, attributeList('NV'), '7701003'), 'Not Recorded');
    assert.equal(describeCode(dictionary, 'eResponse.05', '1'), null);
  });
});
