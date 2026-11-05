import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { parseDataset } from './parse.ts';
import { nemsisModels, PCR_TYPE, placeCodes, resolvePlaces, toPcr } from './pcr.ts';

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
    <ePayment.44>A</ePayment.44><ePayment.47>06</ePayment.47><ePayment.47>09</ePayment.47>
    <ePayment.48>4.6</ePayment.48><ePayment.50>2650003</ePayment.50><ePayment.53>PA-77</ePayment.53>
  </ePayment>
  <eExam><eExam.01>81.6</eExam.01></eExam>
  <eSituation><eSituation.11>R07.9</eSituation.11><eSituation.12>I10</eSituation.12><eSituation.12>E11.9</eSituation.12><eSituation.14>9922005</eSituation.14></eSituation>
  <eInjury><eInjury.01>V43.52XA</eInjury.01></eInjury>
  <eArrest><eArrest.01>3001003</eArrest.01><eArrest.16>3016005</eArrest.16><eArrest.18>3018003</eArrest.18></eArrest>
  <eMedications><eMedications.MedicationGroup><eMedications.03 PN="8801019">4337</eMedications.03><eMedications.04>9927021</eMedications.04></eMedications.MedicationGroup><eMedications.MedicationGroup><eMedications.03>7242</eMedications.03><eMedications.04>9927023</eMedications.04><eMedications.05>0.5</eMedications.05></eMedications.MedicationGroup></eMedications>
  <eProcedures><eProcedures.ProcedureGroup><eProcedures.03 PN="8801023">112798008</eProcedures.03></eProcedures.ProcedureGroup><eProcedures.ProcedureGroup><eProcedures.01>2026-09-14T08:10:00-04:00</eProcedures.01><eProcedures.03>392230005</eProcedures.03></eProcedures.ProcedureGroup></eProcedures>
  <eDisposition><eDisposition.11>2</eDisposition.11><eDisposition.12>4212033</eDisposition.12></eDisposition>
  <eNarrative><eNarrative.01>Pt found sitting.</eNarrative.01></eNarrative>
  <eOther><eOther.SignatureGroup><eOther.12>4512015</eOther.12><eOther.13>4513001</eOther.13><eOther.13>4513005</eOther.13><eOther.15>4515031</eOther.15><eOther.19>2026-09-14T08:22:00-04:00</eOther.19></eOther.SignatureGroup></eOther>
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
        medication: '7242',
        route: '9927023',
        dosage: 0.5,
        dosageUnits: null
      }
    ]);
    assert.deepEqual(pcr.procedures, [
      { performedAt: '2026-09-14T08:10:00-04:00', procedure: '392230005' }
    ]);
    assert.equal(
      (pcr.disposition as { incidentDisposition: string }).incidentDisposition,
      '4212033'
    );
    assert.equal(pcr.narrative, 'Pt found sitting.');
    assert.deepEqual(toPcr(null).insurances, []);
    const payment = pcr.payment as Record<string, unknown>;
    assert.deepEqual(
      [payment.transportReason, payment.ambulanceConditions, payment.priorAuthorization],
      ['A', ['06', '09'], 'PA-77']
    );
    assert.equal((pcr.exam as { weightKg: number }).weightKg, 81.6);
    assert.equal(payment.closestFacilityMiles, 4.6);
    assert.equal((pcr.situation as { workRelated: string }).workRelated, '9922005');
    assert.deepEqual(pcr.injury, { causes: ['V43.52XA'] });
    assert.deepEqual(pcr.arrest, {
      arrest: '3001003',
      discontinuedReason: '3016005',
      outcome: '3018003'
    });
    assert.equal((pcr.disposition as { patientsTransported: number }).patientsTransported, 2);
    assert.deepEqual(pcr.signatures, [
      {
        signer: '4512015',
        reasons: ['4513001', '4513005'],
        representative: null,
        status: '4515031',
        signedAt: '2026-09-14T08:22:00-04:00',
        lastName: null,
        firstName: null
      }
    ]);
  });

  it('leaves out medications and procedures charted as pertinent negatives', () => {
    const pcr = toPcr({
      eMedications: {
        'eMedications.MedicationGroup': {
          'eMedications.03': { '#text': '4337', '@PN': '8801007' }
        }
      },
      eProcedures: {
        'eProcedures.ProcedureGroup': [
          { 'eProcedures.03': { '#text': '112798008', '@PN': '8801001' } },
          { 'eProcedures.03': { '#text': '392230005' } }
        ]
      }
    });
    assert.deepEqual(pcr.medications, []);
    assert.deepEqual(pcr.procedures, [{ performedAt: null, procedure: '392230005' }]);
  });

  it('reads NEMSIS 3.4 gender and 3.5 sex and dispositions side by side', () => {
    const v34 = toPcr({
      ePatient: { 'ePatient.13': '9906003' },
      eDisposition: { 'eDisposition.12': '4212033' }
    });
    assert.deepEqual(
      [
        (v34.patient as Record<string, unknown>).gender,
        (v34.patient as Record<string, unknown>).sex,
        (v34.disposition as Record<string, unknown>).incidentDisposition,
        (v34.disposition as Record<string, unknown>).transportDisposition
      ],
      ['9906003', null, '4212033', null]
    );
    const v35 = toPcr({
      ePatient: { 'ePatient.13': { '@NV': '7701003', '@nil': 'true' }, 'ePatient.25': '9919001' },
      eDisposition: {
        'eDisposition.IncidentDispositionGroup': {
          'eDisposition.27': '4227001',
          'eDisposition.28': '4228001',
          'eDisposition.29': '4229001',
          'eDisposition.30': '4230001'
        }
      }
    });
    assert.deepEqual(
      [
        (v35.patient as Record<string, unknown>).gender,
        (v35.patient as Record<string, unknown>).sex,
        (v35.disposition as Record<string, unknown>).unitDisposition,
        (v35.disposition as Record<string, unknown>).transportDisposition
      ],
      [null, '9919001', '4227001', '4230001']
    );
  });

  it('reads numbers only when they are numbers and integers only when whole', () => {
    const pcr = toPcr({
      ePatient: { 'ePatient.AgeGroup': { 'ePatient.15': '76.5' } },
      eExam: { 'eExam.01': 'heavy' },
      eResponse: { 'eResponse.19': ' 1042.3 ' }
    });
    assert.equal((pcr.patient as Record<string, unknown>).age, null);
    assert.equal((pcr.exam as Record<string, unknown>).weightKg, null);
    assert.equal((pcr.response as Record<string, unknown>).beginOdometer, 1042.3);
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

describe('text cleanup', () => {
  it('drops repeated ~-joined values some ePCR exports produce', () => {
    const company = (name: string) =>
      (
        toPcr({ ePayment: { 'ePayment.InsuranceGroup': { 'ePayment.10': name } } }).insurances as {
          companyName: string | null;
        }[]
      )[0]?.companyName;
    assert.equal(company('UPMC EXCHANGE HMO~UPMC EXCHANGE HMO'), 'UPMC EXCHANGE HMO');
    assert.equal(company(' Highmark ~ PPO Blue '), 'Highmark - PPO Blue');
    assert.equal(company(' ~ '), null);
    assert.equal(company('A~A'), 'A');
  });
});
