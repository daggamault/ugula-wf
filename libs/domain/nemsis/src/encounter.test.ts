import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { modelType } from '@ugula/graph';
import {
  attachmentsOf,
  ENCOUNTER,
  ENCOUNTER_TYPE,
  encounterModels,
  placeCodesOf,
  toEncounter
} from './encounter.ts';
import { parseDataset } from './parse.ts';

const XML = `<EMSDataSet xmlns="http://www.nemsis.org" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><Header>
<PatientCareReport>
  <eRecord><eRecord.01>109412518</eRecord.01></eRecord>
  <eResponse>
    <eResponse.ServiceGroup><eResponse.05>2205001</eResponse.05></eResponse.ServiceGroup>
    <eResponse.20>0</eResponse.20><eResponse.21>11.60</eResponse.21>
    <eResponse.23>2223001</eResponse.23>
    <eResponse.24 NV="7701003" xsi:nil="true"/>
  </eResponse>
  <eTimes><eTimes.06>2026-09-14T07:52:00-04:00</eTimes.06></eTimes>
  <ePatient>
    <ePatient.PatientNameGroup><ePatient.02>Doe</ePatient.02><ePatient.03>Jane</ePatient.03></ePatient.PatientNameGroup>
    <ePatient.05>12 Oak St</ePatient.05><ePatient.06>1192443</ePatient.06><ePatient.08>42</ePatient.08><ePatient.09>16505</ePatient.09>
    <ePatient.17>1950-02-03</ePatient.17>
    <ePatient.AgeGroup><ePatient.15>76</ePatient.15></ePatient.AgeGroup>
  </ePatient>
  <ePayment>
    <ePayment.01 NV="7701003" xsi:nil="true"/>
    <ePayment.InsuranceGroup><ePayment.10>HIGHMARK BCBS</ePayment.10><ePayment.11>2611003</ePayment.11><ePayment.18>M1</ePayment.18></ePayment.InsuranceGroup>
    <ePayment.InsuranceGroup><ePayment.10>MEDICARE</ePayment.10><ePayment.11>2611005</ePayment.11></ePayment.InsuranceGroup>
    <ePayment.44>A</ePayment.44><ePayment.47>06</ePayment.47><ePayment.47>09</ePayment.47>
    <ePayment.48>4.6</ePayment.48><ePayment.50>2650003</ePayment.50><ePayment.53>PA-77</ePayment.53>
  </ePayment>
  <eScene><eScene.09>2209011</eScene.09><eScene.15>9 Elm St</eScene.15><eScene.17>1192443</eScene.17></eScene>
  <eExam><eExam.01>81.6</eExam.01></eExam>
  <eSituation><eSituation.11>R07.9</eSituation.11><eSituation.12>I10</eSituation.12><eSituation.12>E11.9</eSituation.12></eSituation>
  <eMedications><eMedications.MedicationGroup><eMedications.03 PN="8801019">4337</eMedications.03></eMedications.MedicationGroup><eMedications.MedicationGroup><eMedications.03>7242</eMedications.03><eMedications.04>9927023</eMedications.04><eMedications.05>0.5</eMedications.05></eMedications.MedicationGroup></eMedications>
  <eProcedures><eProcedures.ProcedureGroup><eProcedures.01>2026-09-14T08:10:00-04:00</eProcedures.01><eProcedures.03>392230005</eProcedures.03></eProcedures.ProcedureGroup></eProcedures>
  <eDisposition><eDisposition.01>Saint Vincent</eDisposition.01><eDisposition.04>Erie</eDisposition.04><eDisposition.11>2</eDisposition.11><eDisposition.12>4212033</eDisposition.12><eDisposition.21>4221003</eDisposition.21></eDisposition>
  <eNarrative><eNarrative.01>Pt found sitting.</eNarrative.01></eNarrative>
  <eOther>
    <eOther.SignatureGroup><eOther.12>4512015</eOther.12><eOther.13>4513001</eOther.13><eOther.13>4513005</eOther.13><eOther.15>4515031</eOther.15></eOther.SignatureGroup>
    <eOther.FileGroup><eOther.09>4509011</eOther.09><eOther.10>4510011</eOther.10><eOther.11>SGVsbG8=</eOther.11><eOther.22>facesheet.pdf</eOther.22></eOther.FileGroup>
    <eOther.FileGroup><eOther.09>4509011</eOther.09></eOther.FileGroup>
  </eOther>
</PatientCareReport>
</Header></EMSDataSet>`;

const report = () => parseDataset(XML).reports[0];

describe('toEncounter', () => {
  it('reads the trip, the patient, the places and the care in billing terms', () => {
    const e = toEncounter(report(), { '1192443': 'Fairview' });
    assert.deepEqual(
      [e.id, e.pcrNumber, e.revision, e.serviceType, e.responseMode, e.responseModifiers],
      [null, '109412518', null, '2205001', '2223001', []]
    );
    assert.deepEqual(
      [e.incidentDisposition, e.patientsTransported, e.primaryImpression, e.secondaryImpressions],
      ['4212033', 2, 'R07.9', ['I10', 'E11.9']]
    );
    assert.deepEqual(e.odometer, { begin: null, scene: 0, destination: 11.6, end: null });
    assert.equal((e.times as Record<string, unknown>).atScene, '2026-09-14T07:52:00-04:00');
    assert.deepEqual(e.patient, {
      firstName: 'Jane',
      middleName: null,
      lastName: 'Doe',
      birthDate: '1950-02-03',
      age: 76,
      ageUnits: null,
      sex: null,
      gender: null,
      phone: null,
      weightKg: 81.6,
      address: {
        line: '12 Oak St',
        city: 'Fairview',
        county: null,
        state: '42',
        postalCode: '16505'
      }
    });
    assert.deepEqual(e.pickup, {
      name: null,
      type: '2209011',
      address: { line: '9 Elm St', city: 'Fairview', county: null, state: null, postalCode: null }
    });
    assert.deepEqual(
      [(e.destination as { name: string }).name, (e.destination as { type: string }).type],
      ['Saint Vincent', '4221003']
    );
    assert.equal(
      ((e.destination as { address: { city: string } }).address as { city: string }).city,
      'Erie'
    );
    assert.deepEqual(e.medications, [
      { givenAt: null, code: '7242', route: '9927023', dosage: 0.5, dosageUnits: null }
    ]);
    assert.deepEqual(e.procedures, [
      { performedAt: '2026-09-14T08:10:00-04:00', code: '392230005' }
    ]);
    const payment = e.payment as Record<string, unknown>;
    assert.deepEqual(
      [payment.method, payment.transportReason, payment.ambulanceConditions, payment.serviceLevel],
      [null, 'A', ['06', '09'], '2650003']
    );
    assert.deepEqual(
      (e.insurances as { companyName: string; priority: string; memberId: string }[]).map((i) => [
        i.companyName,
        i.priority,
        i.memberId
      ]),
      [
        ['HIGHMARK BCBS', '2611003', 'M1'],
        ['MEDICARE', '2611005', null]
      ]
    );
    assert.deepEqual((e.signatures as { reasons: string[] }[])[0]?.reasons, ['4513001', '4513005']);
    assert.equal(e.narrative, 'Pt found sitting.');
  });

  it('gives an empty report empty lists and nulls, so every field is there to test', () => {
    const e = toEncounter(null);
    assert.deepEqual(
      [e.pcrNumber, e.narrative, e.insurances, e.medications, e.vitals, e.attachments],
      [null, null, [], [], [], []]
    );
    assert.deepEqual(Object.keys(e).sort(), ENCOUNTER.fields.map((f) => f.name).sort());
  });

  it('keeps an unknown place code out of the city', () => {
    const e = toEncounter({ ePatient: { 'ePatient.06': '999' } });
    assert.equal((e.patient as { address: { city: unknown } }).address.city, null);
  });

  it('reads NEMSIS 3.4 gender and 3.5 sex and dispositions side by side', () => {
    const v35 = toEncounter({
      ePatient: { 'ePatient.13': { '@NV': '7701003', '@nil': 'true' }, 'ePatient.25': '9919001' },
      eDisposition: {
        'eDisposition.IncidentDispositionGroup': {
          'eDisposition.27': '4227001',
          'eDisposition.30': '4230001'
        }
      }
    });
    assert.deepEqual(
      [
        (v35.patient as Record<string, unknown>).gender,
        (v35.patient as Record<string, unknown>).sex,
        v35.unitDisposition,
        v35.transportDisposition
      ],
      [null, '9919001', '4227001', '4230001']
    );
  });

  it('reads numbers only when they are numbers and integers only when whole', () => {
    const e = toEncounter({
      ePatient: { 'ePatient.AgeGroup': { 'ePatient.15': '76.5' } },
      eResponse: { 'eResponse.19': ' 1042.3 ', 'eResponse.20': 'Infinity' }
    });
    assert.equal((e.patient as Record<string, unknown>).age, null);
    assert.deepEqual(
      [(e.odometer as { begin: number }).begin, (e.odometer as { scene: unknown }).scene],
      [1042.3, null]
    );
  });

  it('drops repeated ~-joined values some ePCR exports produce', () => {
    const company = (name: string) =>
      (
        toEncounter({ ePayment: { 'ePayment.InsuranceGroup': { 'ePayment.10': name } } })
          .insurances as { companyName: string | null }[]
      )[0]?.companyName;
    assert.equal(company('UPMC EXCHANGE HMO~UPMC EXCHANGE HMO'), 'UPMC EXCHANGE HMO');
    assert.equal(company(' Highmark ~ PPO Blue '), 'Highmark - PPO Blue');
    assert.equal(company(' ~ '), null);
  });
});

describe('attachments', () => {
  it('reads each attached file with content, and pairs the stored files in order', () => {
    assert.deepEqual(attachmentsOf(report()), [{ name: 'facesheet.pdf', data: 'SGVsbG8=' }]);
    const file = { bucket: 'b', key: 'k' };
    assert.deepEqual(toEncounter(report(), {}, [file]).attachments, [
      { documentType: '4509011', fileType: '4510011', name: 'facesheet.pdf', file }
    ]);
  });
});

describe('placeCodesOf', () => {
  it('collects each place code once', () => {
    assert.deepEqual(placeCodesOf(report()), ['1192443']);
    assert.deepEqual(placeCodesOf({}), []);
  });
});

describe('encounter models', () => {
  it('types the Encounter by its fields and gives every nested record its own model', () => {
    assert.deepEqual(ENCOUNTER_TYPE, modelType(ENCOUNTER));
    assert.deepEqual(
      encounterModels.map((m) => m.title),
      [
        'Encounter',
        'Times',
        'Odometer',
        'Person',
        'Address',
        'Scene',
        'Destination',
        'Payment',
        'Insurance',
        'Medication',
        'Procedure',
        'Vital Signs',
        'Signature',
        'Crew Member',
        'Attachment'
      ]
    );
    const impression = ENCOUNTER.fields.find((f) => f.name === 'primaryImpression');
    assert.deepEqual(impression, {
      name: 'primaryImpression',
      type: { code: 'icd10' },
      label: 'Primary Impression',
      description: 'NEMSIS eSituation.11, as the report gives it.'
    });
  });
});
