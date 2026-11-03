import { isRecord, type Json } from '@ugula/graph';
import { XMLBuilder, XMLParser } from 'fast-xml-parser';

const REPEATING = new Set([
  'PatientCareReport',
  'eCrew.CrewGroup',
  'eHistory.08',
  'ePayment.InsuranceGroup',
  'eMedications.MedicationGroup',
  'eProcedures.ProcedureGroup',
  'eSituation.12',
  'eVitals.VitalGroup'
]);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  isArray: (name) => REPEATING.has(name)
});

export const parseDataset = (xml: string): { reports: Json[] } => {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('NEMSIS files must not declare a DOCTYPE');
  const dataset: unknown = parser.parse(xml).EMSDataSet;
  if (!isRecord(dataset)) throw new Error('Not a NEMSIS EMSDataSet document');
  const reports = isRecord(dataset.Header) ? dataset.Header.PatientCareReport : undefined;
  return { reports: Array.isArray(reports) ? (reports as Json[]) : [] };
};

const findText = (value: unknown, key: string): string | null => {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findText(item, key);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const own = value[key];
  if (typeof own === 'string' && own.trim()) return own.trim();
  for (const child of Object.values(value)) {
    const found = findText(child, key);
    if (found !== null) return found;
  }
  return null;
};

export const pcrNumberOf = (report: unknown) => findText(report, 'eRecord.01');

const builder = new XMLBuilder({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  format: true,
  indentBy: '  ',
  suppressEmptyNode: true
});

export const reportXml = (report: Json) =>
  String(builder.build({ PatientCareReport: report })).trim();
