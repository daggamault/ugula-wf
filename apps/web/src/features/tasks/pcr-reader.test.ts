import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readPcr } from './pcr-reader.ts';
import { fixtureDictionary, fixtureReport } from './testing.ts';

const factOf = (facts: { label: string; value: string | null }[], label: string) =>
  facts.find((f) => f.label === label)?.value;

describe('readPcr', () => {
  it('reads a NEMSIS 3.5 report with plain labels and each code with its meaning', () => {
    const pcr = readPcr(fixtureReport('als2-iv-medications.xml'), fixtureDictionary);
    assert.equal(factOf(pcr.patient, 'Name'), 'Rosalind Quintero');
    assert.equal(factOf(pcr.patient, 'Date of Birth'), '1961-02-19');
    assert.equal(factOf(pcr.patient, 'Sex'), 'Female (9919001)');
    assert.equal(factOf(pcr.patient, 'Address'), '330 Market St, Harrisburg (1215162), PA 17101');
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
    assert.deepEqual(
      pcr.times.map((t) => t.label),
      [
        'Call Received',
        'En Route',
        'At Scene',
        'At Patient',
        'Left Scene',
        'At Destination',
        'In Service'
      ]
    );
    assert.equal(pcr.times[0]?.at, '2026-09-06T10:05:00-04:00');
    assert.equal(factOf(pcr.scene, 'Address'), '2645 N 3rd St, Harrisburg (1215162), PA 17110');
    assert.equal(factOf(pcr.destination, 'Name'), 'UPMC Harrisburg');
    assert.equal(
      factOf(pcr.destination, 'Destination Type'),
      'Hospital-Emergency Department (4221003)'
    );
    assert.equal(factOf(pcr.destination, 'Reason for Choosing'), 'Closest Facility (4220001)');
    assert.deepEqual(pcr.response, [
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
    assert.equal(factOf(pcr.situation, 'Complaint'), 'Palpitations');
    assert.equal(
      factOf(pcr.situation, 'Primary Impression'),
      'Supraventricular tachycardia (I47.1)'
    );
    assert.equal(factOf(pcr.situation, 'Primary Symptom'), 'Palpitations (R00.2)');
    assert.equal(factOf(pcr.situation, 'Secondary Impressions'), null);
    assert.deepEqual(pcr.vitals[0], {
      takenAt: '2026-09-06T10:16:00-04:00',
      bloodPressure: '98/64',
      heartRate: 212,
      pulseOximetry: 96,
      respiratoryRate: 22,
      bloodGlucose: null,
      glasgowComaScore: 15
    });
    assert.equal(pcr.medications.length, 4);
    assert.deepEqual(pcr.medications[0], {
      givenAt: '2026-09-06T10:20:00-04:00',
      medication: 'Adenosine (296)',
      route: 'Intravenous (IV) (9927023)',
      dose: '6 Milligrams (mg)'
    });
    assert.equal(pcr.medications[3]?.medication, 'RxNorm 703');
    assert.ok(pcr.narrative?.startsWith('Called to a physician office'));
    assert.equal(pcr.loadedMiles, 6.86);
  });

  it('reads a NEMSIS 3.4 report, with gender for sex and its single incident disposition', () => {
    const pcr = readPcr(fixtureReport('nemsis-34-emergency.xml'), fixtureDictionary);
    assert.equal(factOf(pcr.patient, 'Sex'), 'Female (9906001)');
    assert.equal(pcr.paymentMethod, 'Medicare (2601005)');
    assert.equal(
      factOf(pcr.scene, 'Location Type'),
      'Unspecified place in private residence (Y92.009)'
    );
    assert.deepEqual(
      pcr.response.map((f) => f.label),
      [
        'Type of Service',
        'Response Mode',
        'Level of Care',
        'Incident Disposition',
        'CMS Service Level'
      ]
    );
    assert.equal(
      factOf(pcr.response, 'Incident Disposition'),
      'Patient Treated, Transported by this EMS Unit (4212033)'
    );
    assert.equal(factOf(pcr.response, 'Level of Care'), null);
    assert.equal(pcr.medications[0]?.route, 'Nebulizer (9927071)');
    assert.equal(pcr.loadedMiles, 6.83);
  });

  it('reads procedures, facility names and other symptoms, and leaves an empty report empty', () => {
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
    assert.equal(factOf(pcr.scene, 'Name'), 'Riverside Manor');
    assert.equal(
      factOf(pcr.situation, 'Other Symptoms'),
      'Shortness of breath (R06.02); ICD-10 R07.9'
    );
    assert.deepEqual(pcr.procedures, [
      { performedAt: '2026-09-06T10:20:00-04:00', procedure: 'SNOMED CT 392230005' }
    ]);
    const empty = readPcr(null, fixtureDictionary);
    assert.equal(factOf(empty.patient, 'Name'), null);
    assert.equal(empty.loadedMiles, null);
    assert.deepEqual(empty.vitals, []);
  });
});
