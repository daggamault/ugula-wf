import { elementLabel } from './elements.ts';
import type { JsonValue } from './parse.ts';

type ValueType =
  | 'any'
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean'
  | 'datetime'
  | { list: ValueType }
  | { object: Record<string, ValueType> };

type Kind = 'text' | 'texts' | 'number' | 'integer';

type Element = { name: string; element: string; kind: Kind };

type Section = {
  key: string;
  name: string;
  title: string;
  description: string;
  elements: readonly Element[];
};

export type ModelField = { name: string; type: ValueType; label: string };

export type Model = {
  key: string;
  name: string;
  title: string;
  category: string;
  description: string;
  fields: ModelField[];
};

type Fields = Record<string, JsonValue>;

const CATEGORY = 'NEMSIS';

const el = (name: string, element: string, kind: Kind = 'text'): Element => ({
  name,
  element,
  kind
});

const RESPONSE: Section = {
  key: 'nemsis.response',
  name: 'response',
  title: 'Response',
  description: 'the response section of a patient care report',
  elements: [
    el('incidentNumber', 'eResponse.03'),
    el('responseNumber', 'eResponse.04'),
    el('serviceType', 'eResponse.05'),
    el('transportCapability', 'eResponse.07'),
    el('vehicleNumber', 'eResponse.13'),
    el('callSign', 'eResponse.14'),
    el('beginOdometer', 'eResponse.19', 'number'),
    el('sceneOdometer', 'eResponse.20', 'number'),
    el('destinationOdometer', 'eResponse.21', 'number'),
    el('endOdometer', 'eResponse.22', 'number'),
    el('responseMode', 'eResponse.23'),
    el('responseModifiers', 'eResponse.24', 'texts')
  ]
};

const TIMES: Section = {
  key: 'nemsis.times',
  name: 'times',
  title: 'Times',
  description: 'the times of a patient care report',
  elements: [
    el('psapCall', 'eTimes.01'),
    el('unitNotified', 'eTimes.03'),
    el('enRoute', 'eTimes.05'),
    el('arrivedOnScene', 'eTimes.06'),
    el('arrivedAtPatient', 'eTimes.07'),
    el('leftScene', 'eTimes.09'),
    el('arrivedAtDestination', 'eTimes.11'),
    el('transferOfCare', 'eTimes.12'),
    el('backInService', 'eTimes.13')
  ]
};

const PATIENT: Section = {
  key: 'nemsis.patient',
  name: 'patient',
  title: 'Patient',
  description: 'the patient section of a patient care report',
  elements: [
    el('lastName', 'ePatient.02'),
    el('firstName', 'ePatient.03'),
    el('middleName', 'ePatient.04'),
    el('addressLine', 'ePatient.05'),
    el('city', 'ePatient.06'),
    el('county', 'ePatient.07'),
    el('state', 'ePatient.08'),
    el('postalCode', 'ePatient.09'),
    el('gender', 'ePatient.13'),
    el('age', 'ePatient.15', 'integer'),
    el('ageUnits', 'ePatient.16'),
    el('birthDate', 'ePatient.17'),
    el('phone', 'ePatient.18'),
    el('sex', 'ePatient.25')
  ]
};

const INSURANCE: Section = {
  key: 'nemsis.insurance',
  name: 'insurance',
  title: 'Insurance',
  description: 'one insurance of a patient care report',
  elements: [
    el('companyId', 'ePayment.09'),
    el('companyName', 'ePayment.10'),
    el('priority', 'ePayment.11'),
    el('groupId', 'ePayment.17'),
    el('policyId', 'ePayment.18'),
    el('insuredLastName', 'ePayment.19'),
    el('insuredFirstName', 'ePayment.20'),
    el('relationship', 'ePayment.22')
  ]
};

const PAYMENT: Section = {
  key: 'nemsis.payment',
  name: 'payment',
  title: 'Payment',
  description: 'the payment section of a patient care report',
  elements: [
    el('method', 'ePayment.01'),
    el('certificationStatement', 'ePayment.02'),
    el('certificationDate', 'ePayment.03'),
    el('cmsServiceLevel', 'ePayment.50'),
    el('conditionCodes', 'ePayment.51', 'texts'),
    el('transportationIndicators', 'ePayment.52', 'texts')
  ]
};

const SCENE: Section = {
  key: 'nemsis.scene',
  name: 'scene',
  title: 'Scene',
  description: 'the scene section of a patient care report',
  elements: [
    el('locationType', 'eScene.09'),
    el('addressLine', 'eScene.15'),
    el('city', 'eScene.17'),
    el('state', 'eScene.18'),
    el('postalCode', 'eScene.19'),
    el('county', 'eScene.21')
  ]
};

const SITUATION: Section = {
  key: 'nemsis.situation',
  name: 'situation',
  title: 'Situation',
  description: 'the situation section of a patient care report',
  elements: [
    el('complaint', 'eSituation.04'),
    el('primarySymptom', 'eSituation.09'),
    el('primaryImpression', 'eSituation.11'),
    el('secondaryImpressions', 'eSituation.12', 'texts')
  ]
};

const MEDICATION: Section = {
  key: 'nemsis.medication',
  name: 'medication',
  title: 'Medication',
  description: 'one medication given in a patient care report',
  elements: [
    el('administeredAt', 'eMedications.01'),
    el('medication', 'eMedications.03'),
    el('route', 'eMedications.04'),
    el('dosage', 'eMedications.05', 'number'),
    el('dosageUnits', 'eMedications.06')
  ]
};

const PROCEDURE: Section = {
  key: 'nemsis.procedure',
  name: 'procedure',
  title: 'Procedure',
  description: 'one procedure performed in a patient care report',
  elements: [el('performedAt', 'eProcedures.01'), el('procedure', 'eProcedures.03')]
};

const VITAL: Section = {
  key: 'nemsis.vital',
  name: 'vital',
  title: 'Vital Signs',
  description: 'one set of vital signs from a patient care report',
  elements: [
    el('takenAt', 'eVitals.01'),
    el('systolic', 'eVitals.06', 'number'),
    el('diastolic', 'eVitals.07', 'number'),
    el('heartRate', 'eVitals.10', 'number'),
    el('pulseOximetry', 'eVitals.12', 'number'),
    el('respiratoryRate', 'eVitals.14', 'number'),
    el('bloodGlucose', 'eVitals.18', 'number'),
    el('glasgowComaScore', 'eVitals.23', 'number')
  ]
};

const DISPOSITION: Section = {
  key: 'nemsis.disposition',
  name: 'disposition',
  title: 'Disposition',
  description: 'the disposition section of a patient care report',
  elements: [
    el('destinationName', 'eDisposition.01'),
    el('addressLine', 'eDisposition.03'),
    el('city', 'eDisposition.04'),
    el('state', 'eDisposition.05'),
    el('postalCode', 'eDisposition.07'),
    el('incidentDisposition', 'eDisposition.12'),
    el('transportMethod', 'eDisposition.16'),
    el('transportMode', 'eDisposition.17'),
    el('destinationType', 'eDisposition.21'),
    el('unitDisposition', 'eDisposition.27'),
    el('patientEvaluation', 'eDisposition.28'),
    el('crewDisposition', 'eDisposition.29'),
    el('transportDisposition', 'eDisposition.30'),
    el('levelOfCare', 'eDisposition.32')
  ]
};

const CREW: Section = {
  key: 'nemsis.crew-member',
  name: 'crewMember',
  title: 'Crew Member',
  description: 'one crew member of a patient care report',
  elements: [el('id', 'eCrew.01'), el('level', 'eCrew.02'), el('role', 'eCrew.03')]
};

const SECTIONS = [
  RESPONSE,
  TIMES,
  PATIENT,
  INSURANCE,
  PAYMENT,
  SCENE,
  SITUATION,
  MEDICATION,
  PROCEDURE,
  VITAL,
  DISPOSITION,
  CREW
];

const TYPES: Record<Kind, ValueType> = {
  text: 'string',
  texts: { list: 'string' },
  number: 'number',
  integer: 'integer'
};

const sectionType = (s: Section): ValueType => ({
  object: Object.fromEntries(s.elements.map((e) => [e.name, TYPES[e.kind]]))
});

const fieldsOf = (s: Section): ModelField[] =>
  s.elements.map((e) => ({
    name: e.name,
    type: TYPES[e.kind],
    label: `${elementLabel(e.element) ?? e.name} · ${e.element}`
  }));

const listOf = (s: Section): ValueType => ({ list: sectionType(s) });

const PCR_FIELDS: ModelField[] = [
  { name: 'pcrNumber', type: 'string', label: 'Patient care report number · eRecord.01' },
  { name: 'response', type: sectionType(RESPONSE), label: 'Response' },
  { name: 'times', type: sectionType(TIMES), label: 'Times' },
  { name: 'patient', type: sectionType(PATIENT), label: 'Patient' },
  { name: 'payment', type: sectionType(PAYMENT), label: 'Payment' },
  { name: 'insurances', type: listOf(INSURANCE), label: 'Insurances' },
  { name: 'scene', type: sectionType(SCENE), label: 'Scene' },
  { name: 'situation', type: sectionType(SITUATION), label: 'Situation' },
  { name: 'medications', type: listOf(MEDICATION), label: 'Medications' },
  { name: 'procedures', type: listOf(PROCEDURE), label: 'Procedures' },
  { name: 'vitals', type: listOf(VITAL), label: 'Vital signs' },
  { name: 'disposition', type: sectionType(DISPOSITION), label: 'Disposition' },
  { name: 'narrative', type: 'string', label: 'Narrative · eNarrative.01' },
  { name: 'crew', type: listOf(CREW), label: 'Crew' }
];

export const PCR_TYPE: ValueType = {
  object: Object.fromEntries(PCR_FIELDS.map((f) => [f.name, f.type]))
};

export const nemsisModels: Model[] = [
  {
    key: 'nemsis.pcr',
    name: 'pcr',
    title: 'Patient Care Report',
    category: CATEGORY,
    description: 'a NEMSIS patient care report',
    fields: PCR_FIELDS
  },
  ...SECTIONS.map((s) => ({
    key: s.key,
    name: s.name,
    title: s.title,
    category: CATEGORY,
    description: s.description,
    fields: fieldsOf(s)
  }))
];

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

const textOf = (x: unknown): string | null => {
  const raw = isRecord(x) ? x['#text'] : x;
  return typeof raw === 'string' && raw.trim()
    ? raw.trim()
    : typeof raw === 'number'
      ? String(raw)
      : null;
};

const find = (x: unknown, key: string): unknown => {
  if (Array.isArray(x)) {
    for (const item of x) {
      const found = find(item, key);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (!isRecord(x)) return undefined;
  if (Object.hasOwn(x, key)) return x[key];
  for (const [k, child] of Object.entries(x)) {
    if (k.startsWith('@')) continue;
    const found = find(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
};

const numberOf = (text: string | null) => {
  const n = text === null ? Number.NaN : Number(text);
  return Number.isFinite(n) ? n : null;
};

const elementValue = (x: unknown, { element, kind }: Element): JsonValue => {
  const found = find(x, element);
  const texts = (Array.isArray(found) ? found : [found]).map(textOf);
  const first = texts.find((t) => t !== null) ?? null;
  switch (kind) {
    case 'texts':
      return texts.filter((t): t is string => t !== null);
    case 'number':
      return numberOf(first);
    case 'integer': {
      const n = numberOf(first);
      return n !== null && Number.isInteger(n) ? n : null;
    }
    case 'text':
      return first;
  }
};

const read = (x: unknown, s: Section): Fields =>
  Object.fromEntries(s.elements.map((e) => [e.name, elementValue(x, e)]));

const groups = (report: unknown, group: string) => {
  const found = find(report, group);
  return found === undefined ? [] : Array.isArray(found) ? found : [found];
};

const readAll = (report: unknown, group: string, s: Section) =>
  groups(report, group).map((g) => read(g, s));

export const toPcr = (report: unknown): Fields => ({
  pcrNumber: textOf(find(report, 'eRecord.01')),
  response: read(report, RESPONSE),
  times: read(report, TIMES),
  patient: read(report, PATIENT),
  payment: read(report, PAYMENT),
  insurances: readAll(report, 'ePayment.InsuranceGroup', INSURANCE),
  scene: read(report, SCENE),
  situation: read(report, SITUATION),
  medications: readAll(report, 'eMedications.MedicationGroup', MEDICATION),
  procedures: readAll(report, 'eProcedures.ProcedureGroup', PROCEDURE),
  vitals: readAll(report, 'eVitals.VitalGroup', VITAL),
  disposition: read(report, DISPOSITION),
  narrative: textOf(find(report, 'eNarrative.01')),
  crew: readAll(report, 'eCrew.CrewGroup', CREW)
});
