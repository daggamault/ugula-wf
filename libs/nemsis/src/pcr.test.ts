import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDataset } from './parse.ts';
import { cleanText, nemsisModels, PCR_TYPE, placeCodes, resolvePlaces, toPcr } from './pcr.ts';

const XML = `<EMSDataSet xmlns="http://www.nemsis.org" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Header>
<PatientCareReport>
  <eRecord><eRecord.01>109412518</eRecord.01></eRecord>
  <eResponse>
    <eResponse.ServiceGroup><eResponse.05>2205001</eResponse.05></eResponse.ServiceGroup>
    <eResponse.20>0</eResponse.20><eResponse.21>11.60</eResponse.21>
    <eResponse.23>2223001</eResponse.23>
    <eResponse.24 NV="7701003" xsi:nil="true"/>
  </eResponse>
  <ePatient>
    <ePatient.PatientNameGroup><ePatient.02>Doe</ePatient.02><ePatient.03>Jane</ePatient.03></ePatient.PatientNameGroup>
    <ePatient.17>1950-02-03</ePatient.17>
    <ePatient.AgeGroup><ePatient.15>76</ePatient.15></ePatient.AgeGroup>
  </ePatient>
  <ePayment>
    <ePayment.01 NV="7701003" xsi:nil="true"/>
    <ePayment.InsuranceGroup><ePayment.10>HIGHMARK BCBS</ePayment.10><ePayment.11>2611003</ePayment.11><ePayment.18>M1</ePayment.18></ePayment.InsuranceGroup>
    <ePayment.InsuranceGroup><ePayment.10>MEDICARE</ePayment.10><ePayment.11>2611005</ePayment.11></ePayment.InsuranceGroup>
    <ePayment.50>2650003</ePayment.50>
  </ePayment>
  <eSituation><eSituation.11>R07.9</eSituation.11><eSituation.12>I10</eSituation.12><eSituation.12>E11.9</eSituation.12></eSituation>
  <eMedications><eMedications.MedicationGroup><eMedications.03 PN="8801019">4337</eMedications.03><eMedications.04>9927021</eMedications.04></eMedications.MedicationGroup></eMedications>
  <eDisposition><eDisposition.12>4212033</eDisposition.12></eDisposition>
  <eNarrative><eNarrative.01>Pt found sitting.</eNarrative.01></eNarrative>
</PatientCareReport>
</Header></EMSDataSet>`;

describe('toPcr', () => {
  it('reads typed sections, groups and repeated elements, dropping nil values', () => {
    const [report] = parseDataset(XML).reports;
    const pcr = toPcr(report);
    assert.equal(pcr.pcrNumber, '109412518');
    assert.deepEqual(
      { ...(pcr.response as object) },
      {
        incidentNumber: null,
        responseNumber: null,
        serviceType: '2205001',
        transportCapability: null,
        vehicleNumber: null,
        callSign: null,
        beginOdometer: null,
        sceneOdometer: 0,
        destinationOdometer: 11.6,
        endOdometer: null,
        responseMode: '2223001',
        responseModifiers: []
      }
    );
    assert.equal((pcr.patient as { lastName: string }).lastName, 'Doe');
    assert.equal((pcr.patient as { age: number }).age, 76);
    assert.equal((pcr.payment as { method: null }).method, null);
    assert.equal((pcr.payment as { cmsServiceLevel: string }).cmsServiceLevel, '2650003');
    assert.deepEqual(
      (pcr.insurances as { companyName: string; priority: string }[]).map((i) => [
        i.companyName,
        i.priority
      ]),
      [
        ['HIGHMARK BCBS', '2611003'],
        ['MEDICARE', '2611005']
      ]
    );
    assert.deepEqual((pcr.situation as { secondaryImpressions: string[] }).secondaryImpressions, [
      'I10',
      'E11.9'
    ]);
    assert.deepEqual(pcr.medications, [
      {
        administeredAt: null,
        medication: '4337',
        route: '9927021',
        dosage: null,
        dosageUnits: null
      }
    ]);
    assert.equal(
      (pcr.disposition as { incidentDisposition: string }).incidentDisposition,
      '4212033'
    );
    assert.equal(pcr.narrative, 'Pt found sitting.');
    assert.deepEqual(toPcr(null).insurances, []);
  });

  it('describes the report and each section as labelled models', () => {
    const pcr = nemsisModels.find((m) => m.key === 'nemsis.pcr');
    assert.ok(pcr && typeof PCR_TYPE === 'object' && 'object' in PCR_TYPE);
    assert.deepEqual(
      pcr.fields.map((f) => f.name),
      Object.keys((PCR_TYPE as unknown as { object: object }).object)
    );
    const patient = nemsisModels.find((m) => m.key === 'nemsis.patient');
    assert.equal(patient?.fields[0]?.label, 'Last name · ePatient.02');
    assert.equal(new Set(nemsisModels.map((m) => m.key)).size, nemsisModels.length);
  });

  it('collects GNIS city codes once and swaps them for place names', () => {
    const pcr = toPcr({
      ePatient: { 'ePatient.06': '1192443' },
      eScene: { 'eScene.17': '1192443' },
      eDisposition: { 'eDisposition.04': 'Erie' }
    });
    assert.deepEqual(placeCodes(pcr), ['1192443']);
    const named = resolvePlaces(pcr, { '1192443': 'Fairview' });
    assert.deepEqual(named.scene, {
      ...(pcr.scene as object),
      city: 'Fairview',
      cityCode: '1192443'
    });
    assert.equal((named.disposition as { city: string }).city, 'Erie');
    const label = nemsisModels
      .find((m) => m.key === 'nemsis.scene')
      ?.fields.find((f) => f.name === 'cityCode');
    assert.equal(label?.label, 'Incident city GNIS code · eScene.17');
  });
});

describe('cleanText', () => {
  it('drops repeated ~-joined values some ePCR exports produce', () => {
    assert.equal(cleanText('UPMC EXCHANGE HMO~UPMC EXCHANGE HMO'), 'UPMC EXCHANGE HMO');
    assert.equal(cleanText(' Highmark ~ PPO Blue '), 'Highmark - PPO Blue');
    assert.equal(cleanText(' ~ '), '');
    assert.equal(
      (
        toPcr({ ePayment: { 'ePayment.InsuranceGroup': { 'ePayment.10': 'A~A' } } }).insurances as {
          companyName: string;
        }[]
      )[0]?.companyName,
      'A'
    );
  });
});
