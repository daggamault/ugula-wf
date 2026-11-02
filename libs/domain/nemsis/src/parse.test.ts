import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDataset, pcrNumberOf, reportXml } from './parse.ts';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<EMSDataSet xmlns="http://www.nemsis.org" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <Header>
    <DemographicGroup>
      <dAgency.01>12345</dAgency.01>
      <dAgency.02>Acme EMS</dAgency.02>
    </DemographicGroup>
    <PatientCareReport UUID="pcr-a">
      <eRecord><eRecord.01>PCR-1001</eRecord.01></eRecord>
      <eTimes><eTimes.01>2026-10-01T08:15:00-05:00</eTimes.01></eTimes>
      <ePatient>
        <ePatient.PatientNameGroup>
          <ePatient.02>Doe</ePatient.02>
          <ePatient.03>Jane</ePatient.03>
        </ePatient.PatientNameGroup>
        <ePatient.09>62704</ePatient.09>
        <ePatient.13>9906001</ePatient.13>
        <ePatient.17>1958-04-12</ePatient.17>
      </ePatient>
      <eSituation>
        <eSituation.11>R07.9</eSituation.11>
        <eSituation.12>I10</eSituation.12>
        <eSituation.12>E11.9</eSituation.12>
      </eSituation>
    </PatientCareReport>
    <PatientCareReport UUID="pcr-b">
      <eRecord><eRecord.01>PCR-1002</eRecord.01></eRecord>
      <ePatient>
        <ePatient.PatientNameGroup>
          <ePatient.02>Roe</ePatient.02>
          <ePatient.03>Rich</ePatient.03>
        </ePatient.PatientNameGroup>
        <ePatient.17 xsi:nil="true" NV="7701003"/>
      </ePatient>
      <eSituation><eSituation.12>J44.1</eSituation.12></eSituation>
      <ePayment>
        <ePayment.01>2601005</ePayment.01>
        <ePayment.InsuranceGroup><ePayment.10>Medicare</ePayment.10><ePayment.11>2611003</ePayment.11></ePayment.InsuranceGroup>
      </ePayment>
    </PatientCareReport>
  </Header>
</EMSDataSet>`;

describe('parseDataset', () => {
  it('splits patient care reports and keeps codes as strings', () => {
    const { reports } = parseDataset(SAMPLE);
    assert.equal(reports.length, 2);
    const [first, second] = reports as Record<string, Record<string, unknown>>[];
    assert.deepEqual(first?.eRecord, { 'eRecord.01': 'PCR-1001' });
    assert.equal(first?.['@UUID'], 'pcr-a');
    assert.deepEqual(first?.ePatient?.['ePatient.PatientNameGroup'], {
      'ePatient.02': 'Doe',
      'ePatient.03': 'Jane'
    });
    assert.equal(first?.ePatient?.['ePatient.13'], '9906001');
    assert.deepEqual(first?.eSituation?.['eSituation.12'], ['I10', 'E11.9']);
    assert.deepEqual(second?.eSituation?.['eSituation.12'], ['J44.1']);
    assert.deepEqual(second?.ePatient?.['ePatient.17'], { '@nil': 'true', '@NV': '7701003' });
    assert.deepEqual(second?.ePayment?.['ePayment.InsuranceGroup'], [
      { 'ePayment.10': 'Medicare', 'ePayment.11': '2611003' }
    ]);
  });

  it('rejects documents that are not datasets or declare a DOCTYPE', () => {
    assert.throws(() => parseDataset('<Other/>'), /Not a NEMSIS EMSDataSet/);
    assert.throws(
      () => parseDataset('<!DOCTYPE x [<!ENTITY a "a">]><EMSDataSet/>'),
      /must not declare a DOCTYPE/
    );
    assert.deepEqual(parseDataset('<EMSDataSet><Header/></EMSDataSet>'), { reports: [] });
  });
});

describe('pcrNumberOf', () => {
  it('finds the PCR number anywhere in a report', () => {
    assert.equal(pcrNumberOf({ eRecord: { 'eRecord.01': ' 2026-0042 ' } }), '2026-0042');
    assert.equal(pcrNumberOf([{ x: [{ 'eRecord.01': 'Z' }] }]), 'Z');
    assert.equal(pcrNumberOf({ eRecord: { 'eRecord.01': ' ' } }), null);
    assert.equal(pcrNumberOf(null), null);
  });
});

describe('reportXml', () => {
  it('writes a stored report back as indented NEMSIS XML that parses to the same data', () => {
    const xml = `<EMSDataSet><Header><PatientCareReport>
      <eRecord><eRecord.01>PCR-9</eRecord.01></eRecord>
      <eVitals><eVitals.VitalGroup><eVitals.06>120</eVitals.06></eVitals.VitalGroup><eVitals.VitalGroup><eVitals.06>118</eVitals.06></eVitals.VitalGroup></eVitals>
      <eSituation><eSituation.11 PN="8801005" />
      </eSituation>
    </PatientCareReport></Header></EMSDataSet>`;
    const [report = null] = parseDataset(xml).reports;
    const text = reportXml(report);
    assert.ok(
      text.startsWith('<PatientCareReport>\n  <eRecord>\n    <eRecord.01>PCR-9</eRecord.01>')
    );
    assert.ok(text.includes('<eSituation.11 PN="8801005"/>'));
    assert.equal(text.match(/<eVitals.VitalGroup>/g)?.length, 2);
    const [again] = parseDataset(`<EMSDataSet><Header>${text}</Header></EMSDataSet>`).reports;
    assert.deepEqual(again, report);
  });
});
