import { isRecord, type Json, type Model, type ModelField, type ValueType } from '@ugula/graph';
import { elementLabel } from './elements.ts';

type Kind = 'text' | 'texts' | 'number' | 'integer';

type Element = { name: string; element: string; kind: Kind; label?: string };

type Section = {
  key: string;
  name: string;
  title: string;
  description: string;
  elements: readonly Element[];
};

type Fields = Record<string, Json>;

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
    { ...el('cityCode', 'ePatient.06'), label: 'GNIS code' },
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
    el('certificationReason', 'ePayment.04'),
    el('transportReason', 'ePayment.44'),
    el('ambulanceConditions', 'ePayment.47', 'texts'),
    el('alsAssessment', 'ePayment.49'),
    el('cmsServiceLevel', 'ePayment.50'),
    el('conditionCodes', 'ePayment.51', 'texts'),
    el('transportationIndicators', 'ePayment.52', 'texts'),
    el('closestFacilityMiles', 'ePayment.48', 'number'),
    el('priorAuthorization', 'ePayment.53')
  ]
};

const SCENE: Section = {
  key: 'nemsis.scene',
  name: 'scene',
  title: 'Scene',
  description: 'the scene section of a patient care report',
  elements: [
    el('patientsAtScene', 'eScene.06'),
    el('locationType', 'eScene.09'),
    el('facilityName', 'eScene.13'),
    el('addressLine', 'eScene.15'),
    el('city', 'eScene.17'),
    { ...el('cityCode', 'eScene.17'), label: 'GNIS code' },
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
    el('otherSymptoms', 'eSituation.10', 'texts'),
    el('primaryImpression', 'eSituation.11'),
    el('secondaryImpressions', 'eSituation.12', 'texts'),
    el('workRelated', 'eSituation.14')
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
    { ...el('cityCode', 'eDisposition.04'), label: 'GNIS code' },
    el('state', 'eDisposition.05'),
    el('postalCode', 'eDisposition.07'),
    el('patientsTransported', 'eDisposition.11', 'integer'),
    el('incidentDisposition', 'eDisposition.12'),
    el('destinationReasons', 'eDisposition.20', 'texts'),
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

const EXAM: Section = {
  key: 'nemsis.exam',
  name: 'exam',
  title: 'Exam',
  description: 'the exam section of a patient care report',
  elements: [el('weightKg', 'eExam.01', 'number')]
};

const INJURY: Section = {
  key: 'nemsis.injury',
  name: 'injury',
  title: 'Injury',
  description: 'the injury section of a patient care report',
  elements: [el('causes', 'eInjury.01', 'texts')]
};

const ARREST: Section = {
  key: 'nemsis.arrest',
  name: 'arrest',
  title: 'Cardiac Arrest',
  description: 'the cardiac arrest section of a patient care report',
  elements: [
    el('arrest', 'eArrest.01'),
    el('discontinuedReason', 'eArrest.16'),
    el('outcome', 'eArrest.18')
  ]
};

const SIGNATURE: Section = {
  key: 'nemsis.signature',
  name: 'signature',
  title: 'Signature',
  description: 'one signature collected or attempted in a patient care report',
  elements: [
    el('signer', 'eOther.12'),
    el('reasons', 'eOther.13', 'texts'),
    el('representative', 'eOther.14'),
    el('status', 'eOther.15'),
    el('signedAt', 'eOther.19'),
    el('lastName', 'eOther.20'),
    el('firstName', 'eOther.21')
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
  EXAM,
  INJURY,
  ARREST,
  DISPOSITION,
  SIGNATURE,
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
    label: `${elementLabel(e.element) ?? e.name}${e.label ? ` ${e.label}` : ''} · ${e.element}`
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
  { name: 'exam', type: sectionType(EXAM), label: 'Exam' },
  { name: 'injury', type: sectionType(INJURY), label: 'Injury' },
  { name: 'arrest', type: sectionType(ARREST), label: 'Cardiac arrest' },
  { name: 'disposition', type: sectionType(DISPOSITION), label: 'Disposition' },
  { name: 'narrative', type: 'string', label: 'Narrative · eNarrative.01' },
  { name: 'signatures', type: listOf(SIGNATURE), label: 'Signatures' },
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

const cleanText = (raw: string) =>
  [
    ...new Set(
      raw
        .split('~')
        .map((part) => part.trim())
        .filter(Boolean)
    )
  ].join(' - ');

const textOf = (x: unknown): string | null => {
  const raw = isRecord(x) ? x['#text'] : x;
  return typeof raw === 'string' && cleanText(raw)
    ? cleanText(raw)
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

const elementValue = (x: unknown, { element, kind }: Element): Json => {
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

const isPertinentNegative = (x: unknown) => isRecord(x) && Object.hasOwn(x, '@PN');

const readGiven = (report: unknown, group: string, s: Section, element: string) =>
  groups(report, group)
    .filter((g) => !isPertinentNegative(find(g, element)))
    .map((g) => read(g, s));

export const toPcr = (report: unknown): Fields => ({
  pcrNumber: textOf(find(report, 'eRecord.01')),
  response: read(report, RESPONSE),
  times: read(report, TIMES),
  patient: read(report, PATIENT),
  payment: read(report, PAYMENT),
  insurances: readAll(report, 'ePayment.InsuranceGroup', INSURANCE),
  scene: read(report, SCENE),
  situation: read(report, SITUATION),
  medications: readGiven(report, 'eMedications.MedicationGroup', MEDICATION, 'eMedications.03'),
  procedures: readGiven(report, 'eProcedures.ProcedureGroup', PROCEDURE, 'eProcedures.03'),
  vitals: readAll(report, 'eVitals.VitalGroup', VITAL),
  exam: read(report, EXAM),
  injury: read(report, INJURY),
  arrest: read(report, ARREST),
  disposition: read(report, DISPOSITION),
  narrative: textOf(find(report, 'eNarrative.01')),
  signatures: readAll(report, 'eOther.SignatureGroup', SIGNATURE),
  crew: readAll(report, 'eCrew.CrewGroup', CREW)
});

type PlaceNames = Readonly<Record<string, string>>;

const PLACED = ['patient', 'scene', 'disposition'] as const;

const isGnisCode = (x: Json | undefined): x is string => typeof x === 'string' && /^\d+$/.test(x);

const sectionOf = (pcr: Fields, key: string): Fields => {
  const section = pcr[key];
  return isRecord(section) ? (section as Fields) : {};
};

export const placeCodes = (pcr: Fields): string[] => [
  ...new Set(PLACED.map((k) => sectionOf(pcr, k).city).filter(isGnisCode))
];

export const resolvePlaces = (pcr: Fields, names: PlaceNames): Fields => ({
  ...pcr,
  ...Object.fromEntries(
    PLACED.map((k) => {
      const section = sectionOf(pcr, k);
      const city = section.city;
      return [
        k,
        isGnisCode(city)
          ? { ...section, city: names[city] ?? null, cityCode: city }
          : { ...section, cityCode: null }
      ];
    })
  )
});
