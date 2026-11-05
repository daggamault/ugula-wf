import { readFileSync } from 'node:fs';
import type { Json } from '@ugula/graph';
import { parseDataset, type ReportDictionary } from '@ugula/nemsis';

export const fixtureXml = (name: string) =>
  readFileSync(new URL(`../../../../../.e2e/fixtures/${name}`, import.meta.url), 'utf8');

export const fixtureReport = (name: string): Json => {
  const [report] = parseDataset(fixtureXml(name)).reports;
  if (report === undefined) throw new Error(`${name} has no patient care report`);
  return report;
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
      'I47.1': 'Supraventricular tachycardia'
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
