import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readPcr, roundMiles } from './pcr-reader.ts';
import { fixtureDictionary, fixtureReport } from './testing.ts';

const als = () => readPcr(fixtureReport('als2-iv-medications'), fixtureDictionary);
const copd = () => readPcr(fixtureReport('nemsis-34-emergency'), fixtureDictionary);

describe('readPcr', () => {
  it('reads the patient with each code followed by its meaning', () => {
    assert.deepEqual(als().patient, [
      { label: 'Name', value: 'Rosalind Quintero' },
      { label: 'Date of Birth', value: '1961-02-19', isDay: true },
      { label: 'Sex', value: 'Female (9919001)' },
      { label: 'Address', value: '330 Market St, Harrisburg (1215162), PA 17101' },
      { label: 'Phone', value: null }
    ]);
  });

  it('reads the payment method and insurance', () => {
    const pcr = als();
    assert.equal(pcr.paymentMethod, 'Insurance (2601001)');
    assert.deepEqual(pcr.insurances, [
      {
        payer: 'Blue Plan',
        priority: 'Primary (2611003)',
        memberId: 'XGB110093422',
        groupId: 'GRP-10233',
        relationship: 'Self (2622001)'
      }
    ]);
  });

  it('reads the call times in order', () => {
    assert.deepEqual(als().times, [
      { label: 'Call Received', at: '2026-09-06T10:05:00-04:00' },
      { label: 'En Route', at: '2026-09-06T10:06:00-04:00' },
      { label: 'At Scene', at: '2026-09-06T10:13:00-04:00' },
      { label: 'At Patient', at: '2026-09-06T10:14:00-04:00' },
      { label: 'Left Scene', at: '2026-09-06T10:41:00-04:00' },
      { label: 'At Destination', at: '2026-09-06T10:55:00-04:00' },
      { label: 'In Service', at: '2026-09-06T11:20:00-04:00' }
    ]);
  });

  it('names the code system of a code the dictionary does not know', () => {
    const pcr = als();
    assert.deepEqual(pcr.scene, [
      { label: 'Name', value: null },
      { label: 'Address', value: '2645 N 3rd St, Harrisburg (1215162), PA 17110' },
      { label: 'Location Type', value: 'ICD-10 Y92.531' }
    ]);
    assert.equal(pcr.medications[3]?.medication, 'RxNorm 703');
  });

  it('reads the destination and why it was chosen', () => {
    assert.deepEqual(als().destination, [
      { label: 'Name', value: 'UPMC Harrisburg' },
      { label: 'Address', value: '111 S Front St, Harrisburg (1215162), PA 17101' },
      { label: 'Destination Type', value: 'Hospital-Emergency Department (4221003)' },
      { label: 'Reason for Choosing', value: 'Closest Facility (4220001)' }
    ]);
  });

  it('reads the NEMSIS 3.5 unit, care and transport dispositions', () => {
    assert.deepEqual(als().response, [
      { label: 'Type of Service', value: 'Emergency Response (Primary Response Area) (2205001)' },
      { label: 'Response Mode', value: 'Emergent (Immediate Response) (2223001)' },
      { label: 'Level of Care', value: 'ALS - Paramedic (4232005)' },
      { label: 'Unit Disposition', value: 'Patient Contact Made (4227001)' },
      {
        label: 'Patient Evaluation and Care',
        value: 'Patient Evaluated and Care Provided (4228001)'
      },
      {
        label: 'Transport Disposition',
        value: 'Transport by This EMS Unit (This Crew Only) (4230001)'
      },
      { label: 'CMS Service Level', value: 'ALS, Level 1 Emergency (2650003)' }
    ]);
  });

  it('reads the complaint, impressions and symptoms', () => {
    assert.deepEqual(als().situation, [
      { label: 'Complaint', value: 'Palpitations' },
      { label: 'Primary Impression', value: 'Supraventricular tachycardia, unspecified (I47.10)' },
      { label: 'Secondary Impressions', value: null },
      { label: 'Primary Symptom', value: 'Palpitations (R00.2)' },
      { label: 'Other Symptoms', value: null }
    ]);
  });

  it('reads each set of vitals', () => {
    assert.deepEqual(als().vitals, [
      {
        takenAt: '2026-09-06T10:16:00-04:00',
        bloodPressure: '98/64',
        heartRate: 212,
        pulseOximetry: 96,
        respiratoryRate: 22,
        bloodGlucose: null,
        glasgowComaScore: 15
      },
      {
        takenAt: '2026-09-06T10:38:00-04:00',
        bloodPressure: '122/78',
        heartRate: 96,
        pulseOximetry: 98,
        respiratoryRate: 18,
        bloodGlucose: null,
        glasgowComaScore: 15
      }
    ]);
  });

  it('reads each medication with its route and dose, keeping unknown codes as given', () => {
    assert.deepEqual(als().medications, [
      {
        givenAt: '2026-09-06T10:20:00-04:00',
        medication: 'Adenosine (296)',
        route: 'Intravenous (IV) (9927023)',
        dose: '6 Milligrams (mg)'
      },
      {
        givenAt: '2026-09-06T10:23:00-04:00',
        medication: 'Adenosine (296)',
        route: 'Intravenous (IV) (9927023)',
        dose: '12 Milligrams (mg)'
      },
      {
        givenAt: '2026-09-06T10:26:00-04:00',
        medication: 'RxNorm 313002',
        route: 'Intravenous (IV) (9927023)',
        dose: '20 3706025'
      },
      {
        givenAt: '2026-09-06T10:31:00-04:00',
        medication: 'RxNorm 703',
        route: '9927069',
        dose: '150 Milligrams (mg)'
      }
    ]);
  });

  it('reads the narrative, odometer and the miles driven loaded', () => {
    const pcr = als();
    assert.equal(pcr.narrative?.slice(0, 28), 'Called to a physician office');
    assert.deepEqual(pcr.odometer, [
      { label: 'At Scene', value: '31893' },
      { label: 'At Destination', value: '31899.86' }
    ]);
    assert.equal(pcr.loadedMiles, 6.86);
    assert.deepEqual(pcr.procedures, []);
  });

  it('reads NEMSIS 3.4 gender as sex, dropping the deprecated mark', () => {
    const pcr = copd();
    assert.deepEqual(pcr.patient[2], { label: 'Sex', value: 'Female (9906001)' });
    assert.equal(pcr.paymentMethod, 'Medicare (2601005)');
    assert.equal(pcr.insurances[0]?.groupId, null);
  });

  it('reads the single NEMSIS 3.4 incident disposition in place of the 3.5 ones', () => {
    assert.deepEqual(copd().response, [
      { label: 'Type of Service', value: 'Emergency Response (Primary Response Area) (2205001)' },
      { label: 'Response Mode', value: 'Emergent (Immediate Response) (2223001)' },
      { label: 'Level of Care', value: null },
      {
        label: 'Incident Disposition',
        value: 'Patient Treated, Transported by this EMS Unit (4212033)'
      },
      { label: 'CMS Service Level', value: 'ALS, Level 1 Emergency (2650003)' }
    ]);
  });

  it('rounds the loaded miles to hundredths', () => {
    const pcr = copd();
    assert.deepEqual(pcr.odometer, [
      { label: 'At Scene', value: '12034.5' },
      { label: 'At Destination', value: '12041.33' }
    ]);
    assert.equal(pcr.loadedMiles, 6.83);
  });

  it('reads a facility scene, several other symptoms and procedures', () => {
    const pcr = readPcr(
      {
        eScene: { 'eScene.13': 'Riverside Manor' },
        eSituation: { 'eSituation.10': ['R06.02', 'R07.9'] },
        eProcedures: {
          'eProcedures.ProcedureGroup': [
            { 'eProcedures.01': '2026-09-06T10:20:00-04:00', 'eProcedures.03': '392230005' }
          ]
        }
      },
      fixtureDictionary
    );
    assert.deepEqual(pcr.scene[0], { label: 'Name', value: 'Riverside Manor' });
    assert.deepEqual(pcr.situation[4], {
      label: 'Other Symptoms',
      value: 'Shortness of breath (R06.02); ICD-10 R07.9'
    });
    assert.deepEqual(pcr.procedures, [
      { performedAt: '2026-09-06T10:20:00-04:00', procedure: 'SNOMED CT 392230005' }
    ]);
  });

  it('reads partial vitals, a dose without units and a payer known only by id', () => {
    const pcr = readPcr(
      {
        eVitals: { 'eVitals.VitalGroup': { 'eVitals.06': '140' } },
        eMedications: {
          'eMedications.MedicationGroup': [
            { 'eMedications.03': '435', 'eMedications.05': '2' },
            { 'eMedications.03': '296' }
          ]
        },
        ePayment: { 'ePayment.InsuranceGroup': { 'ePayment.09': 'P-77' } },
        eResponse: { 'eResponse.20': '100' }
      },
      fixtureDictionary
    );
    assert.deepEqual(pcr.vitals, [
      {
        takenAt: null,
        bloodPressure: '140/—',
        heartRate: null,
        pulseOximetry: null,
        respiratoryRate: null,
        bloodGlucose: null,
        glasgowComaScore: null
      }
    ]);
    assert.deepEqual(
      pcr.medications.map((m) => m.dose),
      ['2', null]
    );
    assert.deepEqual(pcr.insurances, [
      { payer: 'P-77', priority: null, memberId: null, groupId: null, relationship: null }
    ]);
    assert.deepEqual(pcr.odometer, [
      { label: 'At Scene', value: '100' },
      { label: 'At Destination', value: null }
    ]);
    assert.equal(pcr.loadedMiles, null);
  });

  it('leaves every fact of an empty report empty', () => {
    const empty = readPcr(null, fixtureDictionary);
    assert.deepEqual(
      [
        ...empty.patient,
        ...empty.scene,
        ...empty.destination,
        ...empty.response,
        ...empty.situation,
        ...empty.odometer
      ].filter((f) => f.value !== null),
      []
    );
    assert.deepEqual(
      empty.times.filter((t) => t.at !== null),
      []
    );
    assert.deepEqual(
      [empty.insurances, empty.vitals, empty.medications, empty.procedures],
      [[], [], [], []]
    );
    assert.deepEqual([empty.paymentMethod, empty.narrative, empty.loadedMiles], [null, null, null]);
  });
});

describe('roundMiles', () => {
  it('rounds to hundredths, hiding float error', () => {
    assert.equal(roundMiles(12041.33 - 12034.5), 6.83);
    assert.equal(roundMiles(1.005), 1);
    assert.equal(roundMiles(2.456), 2.46);
    assert.equal(roundMiles(0), 0);
  });
});
