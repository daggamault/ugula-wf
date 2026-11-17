import type { Json } from '@ugula/graph';
import type { ReportDictionary } from '@ugula/nemsis';

const vitals = (takenAt: string, bp: [string, string], hr: string, spo2: string, rr: string) => ({
  'eVitals.01': takenAt,
  'eVitals.BloodPressureGroup': { 'eVitals.06': bp[0], 'eVitals.07': bp[1] },
  'eVitals.HeartRateGroup': { 'eVitals.10': hr },
  'eVitals.12': spo2,
  'eVitals.14': rr,
  'eVitals.GlasgowScoreGroup': { 'eVitals.23': '15' }
});

const medication = (givenAt: string, code: string, route: string, dose: string, unit: string) => ({
  'eMedications.01': givenAt,
  'eMedications.03': code,
  'eMedications.04': route,
  'eMedications.DosageGroup': { 'eMedications.05': dose, 'eMedications.06': unit }
});

const DESTINATION = {
  'eDisposition.01': 'UPMC Harrisburg',
  'eDisposition.03': '111 S Front St',
  'eDisposition.04': '1215162',
  'eDisposition.05': '42',
  'eDisposition.07': '17101'
};

const TRANSPORT = { 'eDisposition.20': '4220001', 'eDisposition.21': '4221003' };

export const alsReport: Json = {
  eResponse: {
    'eResponse.ServiceGroup': { 'eResponse.05': '2205001' },
    'eResponse.20': '31893.0',
    'eResponse.21': '31899.86',
    'eResponse.23': '2223001'
  },
  eTimes: {
    'eTimes.01': '2026-09-06T10:05:00-04:00',
    'eTimes.05': '2026-09-06T10:06:00-04:00',
    'eTimes.06': '2026-09-06T10:13:00-04:00',
    'eTimes.07': '2026-09-06T10:14:00-04:00',
    'eTimes.09': '2026-09-06T10:41:00-04:00',
    'eTimes.11': '2026-09-06T10:55:00-04:00',
    'eTimes.13': '2026-09-06T11:20:00-04:00'
  },
  ePatient: {
    'ePatient.PatientNameGroup': { 'ePatient.02': 'Quintero', 'ePatient.03': 'Rosalind' },
    'ePatient.05': '330 Market St',
    'ePatient.06': '1215162',
    'ePatient.08': '42',
    'ePatient.09': '17101',
    'ePatient.17': '1961-02-19',
    'ePatient.25': '9919001'
  },
  ePayment: {
    'ePayment.01': '2601001',
    'ePayment.InsuranceGroup': [
      {
        'ePayment.10': 'Blue Plan',
        'ePayment.11': '2611003',
        'ePayment.17': 'GRP-10233',
        'ePayment.18': 'XGB110093422',
        'ePayment.22': '2622001'
      }
    ],
    'ePayment.50': '2650003'
  },
  eScene: {
    'eScene.09': 'Y92.531',
    'eScene.15': '2645 N 3rd St',
    'eScene.17': '1215162',
    'eScene.18': '42',
    'eScene.19': '17110'
  },
  eSituation: {
    'eSituation.04': 'Palpitations',
    'eSituation.09': 'R00.2',
    'eSituation.11': 'I47.10'
  },
  eVitals: {
    'eVitals.VitalGroup': [
      vitals('2026-09-06T10:16:00-04:00', ['98', '64'], '212', '96', '22'),
      vitals('2026-09-06T10:38:00-04:00', ['122', '78'], '96', '98', '18')
    ]
  },
  eMedications: {
    'eMedications.MedicationGroup': [
      medication('2026-09-06T10:20:00-04:00', '296', '9927023', '6', '3706021'),
      medication('2026-09-06T10:23:00-04:00', '296', '9927023', '12', '3706021'),
      medication('2026-09-06T10:26:00-04:00', '313002', '9927023', '20', '3706025'),
      medication('2026-09-06T10:31:00-04:00', '703', '9927069', '150', '3706021')
    ]
  },
  eNarrative: {
    'eNarrative.01':
      'Called to a physician office for a 65 y/o female with palpitations, SVT at 212 on the monitor. Adenosine 6 mg and 12 mg rapid IV push, then amiodarone 150 mg IV with conversion to sinus rhythm. Transported to Harrisburg ED.'
  },
  eDisposition: {
    'eDisposition.DestinationGroup': DESTINATION,
    'eDisposition.IncidentDispositionGroup': {
      'eDisposition.27': '4227001',
      'eDisposition.28': '4228001',
      'eDisposition.30': '4230001'
    },
    'eDisposition.TransportDispositionGroup': TRANSPORT,
    'eDisposition.32': '4232005'
  }
};

export const nemsis34Report: Json = {
  eResponse: {
    'eResponse.ServiceGroup': { 'eResponse.05': '2205001' },
    'eResponse.20': '12034.5',
    'eResponse.21': '12041.33',
    'eResponse.23': '2223001'
  },
  ePatient: {
    'ePatient.PatientNameGroup': { 'ePatient.02': 'Thorncastle', 'ePatient.03': 'Wilhelmina' },
    'ePatient.13': '9906001',
    'ePatient.17': '1958-12-01'
  },
  ePayment: {
    'ePayment.01': '2601005',
    'ePayment.InsuranceGroup': [{ 'ePayment.10': 'Medicare', 'ePayment.18': '4MX9KT2RV63' }],
    'ePayment.50': '2650003'
  },
  eDisposition: {
    'eDisposition.DestinationGroup': DESTINATION,
    'eDisposition.12': '4212033',
    'eDisposition.TransportDispositionGroup': TRANSPORT
  }
};
export const fixtureDictionary: ReportDictionary = {
  elements: {},
  codes: {
    'ePatient.06': { '1215162': 'Harrisburg' },
    'ePatient.08': { '42': 'PA' },
    'ePatient.13': { '9906001': 'Female (DEPRECATED)' },
    'ePatient.25': { '9919001': 'Female' },
    'ePayment.01': { '2601001': 'Insurance', '2601005': 'Medicare' },
    'ePayment.11': { '2611003': 'Primary' },
    'ePayment.22': { '2622001': 'Self' },
    'ePayment.50': { '2650003': 'ALS, Level 1 Emergency' },
    'eResponse.05': { '2205001': 'Emergency Response (Primary Response Area)' },
    'eResponse.23': { '2223001': 'Emergent (Immediate Response)' },
    'eScene.09': { 'Y92.009': 'Unspecified place in private residence' },
    'eScene.17': { '1215162': 'Harrisburg' },
    'eScene.18': { '42': 'PA' },
    'eSituation.10': { 'R06.02': 'Shortness of breath' },
    'eSituation.09': { 'R06.02': 'Shortness of breath', 'R00.2': 'Palpitations' },
    'eSituation.11': {
      'J44.1': 'Chronic obstructive pulmonary disease with (acute) exacerbation',
      'I47.10': 'Supraventricular tachycardia, unspecified'
    },
    'eMedications.03': { '435': 'Albuterol', '296': 'Adenosine' },
    'eMedications.04': { '9927071': 'Nebulizer', '9927023': 'Intravenous (IV)' },
    'eMedications.06': { '3706021': 'Milligrams (mg)' },
    'eDisposition.04': { '1215162': 'Harrisburg' },
    'eDisposition.05': { '42': 'PA' },
    'eDisposition.12': { '4212033': 'Patient Treated, Transported by this EMS Unit' },
    'eDisposition.20': { '4220001': 'Closest Facility' },
    'eDisposition.21': { '4221003': 'Hospital-Emergency Department' },
    'eDisposition.27': { '4227001': 'Patient Contact Made' },
    'eDisposition.28': { '4228001': 'Patient Evaluated and Care Provided' },
    'eDisposition.30': { '4230001': 'Transport by This EMS Unit (This Crew Only)' },
    'eDisposition.32': { '4232005': 'ALS - Paramedic' }
  }
};
