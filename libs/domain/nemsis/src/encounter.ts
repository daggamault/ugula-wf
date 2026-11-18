import { isRecord, type Json, type Model, modelType, type ValueType } from '@ugula/graph';
import { elementLabel } from './elements.ts';
import { BLOB } from './reports.ts';

type Kind = 'text' | 'texts' | 'number' | 'integer' | 'datetime' | 'icd10' | 'icd10s';

type Element = { name: string; element: string; kind: Kind };

type Fields = Record<string, Json>;

type Part = {
  key: string;
  name: string;
  title: string;
  description: string;
  elements: readonly Element[];
};

const CATEGORY = 'Encounter';

const TYPES: Record<Kind, ValueType> = {
  text: 'string',
  texts: { list: 'string' },
  number: 'number',
  integer: 'integer',
  datetime: 'datetime',
  icd10: { code: 'icd10' },
  icd10s: { list: { code: 'icd10' } }
};

const el = (name: string, element: string, kind: Kind = 'text'): Element => ({
  name,
  element,
  kind
});

const fieldOf = (e: Element) => ({
  name: e.name,
  type: TYPES[e.kind],
  label: `${elementLabel(e.element) ?? e.name} · ${e.element}`
});

const partModel = (p: Part): Model => ({
  key: p.key,
  name: p.name,
  title: p.title,
  category: CATEGORY,
  description: p.description,
  fields: p.elements.map(fieldOf)
});

const addressOf = (line: string, city: string, county: string, state: string, zip: string) => [
  el('line', line),
  el('city', city),
  el('county', county),
  el('state', state),
  el('postalCode', zip)
];

const ADDRESS_FIELDS = [
  { name: 'line', type: 'string', label: 'Street address' },
  { name: 'city', type: 'string', label: 'City' },
  { name: 'county', type: 'string', label: 'County' },
  { name: 'state', type: 'string', label: 'State' },
  { name: 'postalCode', type: 'string', label: 'ZIP code' }
] as const;

const ADDRESS: Model = {
  key: 'address',
  name: 'address',
  title: 'Address',
  category: CATEGORY,
  description: 'a street address, with the city named even when the report gave a place code',
  fields: ADDRESS_FIELDS
};

const ADDRESS_TYPE = modelType(ADDRESS);

const PATIENT_ADDRESS = addressOf(
  'ePatient.05',
  'ePatient.06',
  'ePatient.07',
  'ePatient.08',
  'ePatient.09'
);

const SCENE_ADDRESS = addressOf('eScene.15', 'eScene.17', 'eScene.21', 'eScene.18', 'eScene.19');

const DESTINATION_ADDRESS = addressOf(
  'eDisposition.03',
  'eDisposition.04',
  'eDisposition.06',
  'eDisposition.05',
  'eDisposition.07'
);

const PERSON_ELEMENTS = [
  el('firstName', 'ePatient.03'),
  el('middleName', 'ePatient.04'),
  el('lastName', 'ePatient.02'),
  el('birthDate', 'ePatient.17'),
  el('age', 'ePatient.15', 'integer'),
  el('ageUnits', 'ePatient.16'),
  el('sex', 'ePatient.25'),
  el('gender', 'ePatient.13'),
  el('phone', 'ePatient.18'),
  el('weightKg', 'eExam.01', 'number')
];

const PERSON: Model = {
  key: 'person',
  name: 'person',
  title: 'Person',
  category: CATEGORY,
  description: 'a person as the report names them: name, birth date, sex, address and phone',
  fields: [
    ...PERSON_ELEMENTS.map(fieldOf),
    { name: 'address', type: ADDRESS_TYPE, label: 'Home address' }
  ]
};

const LOCATION: Model = {
  key: 'location',
  name: 'location',
  title: 'Location',
  category: CATEGORY,
  description: 'a place the trip started or ended: its name, type and address',
  fields: [
    { name: 'name', type: 'string', label: 'Name of the facility or place' },
    { name: 'type', type: 'string', label: 'Type of place (NEMSIS code)' },
    { name: 'address', type: ADDRESS_TYPE, label: 'Address' }
  ]
};

const TIMES: Part = {
  key: 'times',
  name: 'times',
  title: 'Times',
  description: 'the times of a trip, from the call to back in service',
  elements: [
    el('call', 'eTimes.01', 'datetime'),
    el('unitNotified', 'eTimes.03', 'datetime'),
    el('enRoute', 'eTimes.05', 'datetime'),
    el('atScene', 'eTimes.06', 'datetime'),
    el('atPatient', 'eTimes.07', 'datetime'),
    el('leftScene', 'eTimes.09', 'datetime'),
    el('atDestination', 'eTimes.11', 'datetime'),
    el('transferOfCare', 'eTimes.12', 'datetime'),
    el('backInService', 'eTimes.13', 'datetime')
  ]
};

const ODOMETER: Part = {
  key: 'odometer',
  name: 'odometer',
  title: 'Odometer',
  description: 'the vehicle odometer at each point of a trip',
  elements: [
    el('begin', 'eResponse.19', 'number'),
    el('scene', 'eResponse.20', 'number'),
    el('destination', 'eResponse.21', 'number'),
    el('end', 'eResponse.22', 'number')
  ]
};

const PAYMENT: Part = {
  key: 'payment',
  name: 'payment',
  title: 'Payment',
  description:
    'what the report records for billing: payment method, physician certification, transport reason and conditions',
  elements: [
    el('method', 'ePayment.01'),
    el('certification', 'ePayment.02'),
    el('certificationDate', 'ePayment.03'),
    el('certificationReason', 'ePayment.04'),
    el('transportReason', 'ePayment.44'),
    el('ambulanceConditions', 'ePayment.47', 'texts'),
    el('closestFacilityMiles', 'ePayment.48', 'number'),
    el('alsAssessment', 'ePayment.49'),
    el('serviceLevel', 'ePayment.50'),
    el('conditionCodes', 'ePayment.51', 'texts'),
    el('transportIndicators', 'ePayment.52', 'texts'),
    el('priorAuthorization', 'ePayment.53')
  ]
};

const INSURANCE: Part = {
  key: 'insurance',
  name: 'insurance',
  title: 'Insurance',
  description: 'one insurance as the report gives it, before it is matched to a payer',
  elements: [
    el('companyId', 'ePayment.09'),
    el('companyName', 'ePayment.10'),
    el('priority', 'ePayment.11'),
    el('groupId', 'ePayment.17'),
    el('memberId', 'ePayment.18'),
    el('insuredLastName', 'ePayment.19'),
    el('insuredFirstName', 'ePayment.20'),
    el('relationship', 'ePayment.22')
  ]
};

const MEDICATION: Part = {
  key: 'medication',
  name: 'medication',
  title: 'Medication',
  description: 'one medication the crew gave',
  elements: [
    el('givenAt', 'eMedications.01', 'datetime'),
    el('code', 'eMedications.03'),
    el('route', 'eMedications.04'),
    el('dosage', 'eMedications.05', 'number'),
    el('dosageUnits', 'eMedications.06')
  ]
};

const PROCEDURE: Part = {
  key: 'procedure',
  name: 'procedure',
  title: 'Procedure',
  description: 'one procedure the crew performed',
  elements: [el('performedAt', 'eProcedures.01', 'datetime'), el('code', 'eProcedures.03')]
};

const VITAL: Part = {
  key: 'vital',
  name: 'vital',
  title: 'Vital Signs',
  description: 'one set of vital signs',
  elements: [
    el('takenAt', 'eVitals.01', 'datetime'),
    el('systolic', 'eVitals.06', 'number'),
    el('diastolic', 'eVitals.07', 'number'),
    el('heartRate', 'eVitals.10', 'number'),
    el('pulseOximetry', 'eVitals.12', 'number'),
    el('respiratoryRate', 'eVitals.14', 'number'),
    el('bloodGlucose', 'eVitals.18', 'number'),
    el('glasgowComaScore', 'eVitals.23', 'number')
  ]
};

const SIGNATURE: Part = {
  key: 'signature',
  name: 'signature',
  title: 'Signature',
  description: 'one signature collected or attempted',
  elements: [
    el('signer', 'eOther.12'),
    el('reasons', 'eOther.13', 'texts'),
    el('representative', 'eOther.14'),
    el('status', 'eOther.15'),
    el('signedAt', 'eOther.19', 'datetime'),
    el('lastName', 'eOther.20'),
    el('firstName', 'eOther.21')
  ]
};

const CREW_MEMBER: Part = {
  key: 'crew-member',
  name: 'crewMember',
  title: 'Crew Member',
  description: 'one member of the crew',
  elements: [el('id', 'eCrew.01'), el('level', 'eCrew.02'), el('role', 'eCrew.03')]
};

const ATTACHMENT_ELEMENTS = [
  el('documentType', 'eOther.09'),
  el('fileType', 'eOther.10'),
  el('name', 'eOther.22')
];

const ATTACHMENT: Model = {
  key: 'attachment',
  name: 'attachment',
  title: 'Attachment',
  category: CATEGORY,
  description: 'one file attached to the report, such as a facesheet or a physician certification',
  fields: [...ATTACHMENT_ELEMENTS.map(fieldOf), { name: 'file', type: BLOB, label: 'Stored file' }]
};

const typeOf = (p: Part) => modelType(partModel(p));

const listOf = (t: ValueType): ValueType => ({ list: t });

const TRIP_ELEMENTS = [
  el('incidentNumber', 'eResponse.03'),
  el('serviceType', 'eResponse.05'),
  el('unitNumber', 'eResponse.13'),
  el('callSign', 'eResponse.14'),
  el('responseMode', 'eResponse.23'),
  el('responseModifiers', 'eResponse.24', 'texts'),
  el('incidentDisposition', 'eDisposition.12'),
  el('unitDisposition', 'eDisposition.27'),
  el('patientEvaluation', 'eDisposition.28'),
  el('crewDisposition', 'eDisposition.29'),
  el('transportDisposition', 'eDisposition.30'),
  el('levelOfCare', 'eDisposition.32'),
  el('transportMode', 'eDisposition.17'),
  el('destinationReasons', 'eDisposition.20', 'texts'),
  el('patientsAtScene', 'eScene.06'),
  el('patientsTransported', 'eDisposition.11', 'integer')
];

const CLINICAL_ELEMENTS = [
  el('complaint', 'eSituation.04'),
  el('primarySymptom', 'eSituation.09'),
  el('otherSymptoms', 'eSituation.10', 'texts'),
  el('primaryImpression', 'eSituation.11', 'icd10'),
  el('secondaryImpressions', 'eSituation.12', 'icd10s'),
  el('workRelated', 'eSituation.14'),
  el('injuryCauses', 'eInjury.01', 'texts'),
  el('cardiacArrest', 'eArrest.01'),
  el('arrestOutcome', 'eArrest.18')
];

export const ENCOUNTER: Model = {
  key: 'encounter',
  name: 'encounter',
  title: 'Encounter',
  category: CATEGORY,
  description:
    'one patient care report: the trip, the patient, the care given and the billing details',
  fields: [
    { name: 'id', type: { id: 'encounter' }, label: 'Encounter ID' },
    { name: 'pcrNumber', type: 'string', label: 'Patient care report number · eRecord.01' },
    { name: 'revision', type: 'integer', label: 'Revision, 1 for the first copy received' },
    { name: 'reportId', type: { id: 'report' }, label: 'Report this copy was read from' },
    ...TRIP_ELEMENTS.map(fieldOf),
    { name: 'times', type: typeOf(TIMES), label: 'Times' },
    { name: 'odometer', type: typeOf(ODOMETER), label: 'Odometer' },
    { name: 'patient', type: modelType(PERSON), label: 'Patient' },
    { name: 'pickup', type: modelType(LOCATION), label: 'Pickup (the scene)' },
    { name: 'destination', type: modelType(LOCATION), label: 'Destination' },
    ...CLINICAL_ELEMENTS.map(fieldOf),
    { name: 'medications', type: listOf(typeOf(MEDICATION)), label: 'Medications given' },
    { name: 'procedures', type: listOf(typeOf(PROCEDURE)), label: 'Procedures performed' },
    { name: 'vitals', type: listOf(typeOf(VITAL)), label: 'Vital signs' },
    { name: 'payment', type: typeOf(PAYMENT), label: 'Payment' },
    { name: 'insurances', type: listOf(typeOf(INSURANCE)), label: 'Insurances as reported' },
    { name: 'signatures', type: listOf(typeOf(SIGNATURE)), label: 'Signatures' },
    { name: 'crew', type: listOf(typeOf(CREW_MEMBER)), label: 'Crew' },
    { name: 'narrative', type: 'string', label: 'Narrative · eNarrative.01' },
    { name: 'attachments', type: listOf(modelType(ATTACHMENT)), label: 'Attached files' }
  ]
};

export const ENCOUNTER_TYPE = modelType(ENCOUNTER);

export const encounterModels: Model[] = [
  ENCOUNTER,
  partModel(TIMES),
  partModel(ODOMETER),
  PERSON,
  ADDRESS,
  LOCATION,
  ...[PAYMENT, INSURANCE, MEDICATION, PROCEDURE, VITAL, SIGNATURE, CREW_MEMBER].map(partModel),
  ATTACHMENT
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
  if (typeof raw === 'number') return String(raw);
  return typeof raw === 'string' && cleanText(raw) ? cleanText(raw) : null;
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
    case 'icd10s':
      return texts.filter((t): t is string => t !== null);
    case 'number':
      return numberOf(first);
    case 'integer': {
      const n = numberOf(first);
      return n !== null && Number.isInteger(n) ? n : null;
    }
    case 'text':
    case 'datetime':
    case 'icd10':
      return first;
  }
};

const read = (x: unknown, elements: readonly Element[]): Fields =>
  Object.fromEntries(elements.map((e) => [e.name, elementValue(x, e)]));

const groups = (report: unknown, group: string): unknown[] => {
  const found = find(report, group);
  return found === undefined ? [] : Array.isArray(found) ? found : [found];
};

const isPertinentNegative = (x: unknown) => isRecord(x) && Object.hasOwn(x, '@PN');

const readGroups = (report: unknown, group: string, p: Part, given?: string) =>
  groups(report, group)
    .filter((g) => !given || !isPertinentNegative(find(g, given)))
    .map((g) => read(g, p.elements));

type PlaceNames = Readonly<Record<string, string>>;

const isPlaceCode = (x: Json | undefined): x is string => typeof x === 'string' && /^\d+$/.test(x);

const named = (address: Fields, names: PlaceNames): Fields =>
  isPlaceCode(address.city) ? { ...address, city: names[address.city] ?? null } : address;

const PLACE_ELEMENTS = ['ePatient.06', 'eScene.17', 'eDisposition.04'];

export const placeCodesOf = (report: unknown): string[] => [
  ...new Set(
    PLACE_ELEMENTS.map((e) => textOf(find(report, e))).filter((c): c is string => isPlaceCode(c))
  )
];

type Attachment = { name: string | null; data: string };

const fileGroups = (report: unknown) =>
  groups(report, 'eOther.FileGroup').filter((g) => textOf(find(g, 'eOther.11')) !== null);

export const attachmentsOf = (report: unknown): Attachment[] =>
  fileGroups(report).map((g) => ({
    name: textOf(find(g, 'eOther.22')),
    data: textOf(find(g, 'eOther.11')) ?? ''
  }));

export const toEncounter = (
  report: unknown,
  names: PlaceNames = {},
  files: readonly Json[] = []
): Fields => {
  const text = (element: string) => textOf(find(report, element));
  const address = (elements: readonly Element[]) => named(read(report, elements), names);
  const location = (name: string, type: string, elements: readonly Element[]) => ({
    name: text(name),
    type: text(type),
    address: address(elements)
  });
  return {
    id: null,
    pcrNumber: text('eRecord.01'),
    revision: null,
    reportId: null,
    ...read(report, TRIP_ELEMENTS),
    times: read(report, TIMES.elements),
    odometer: read(report, ODOMETER.elements),
    patient: { ...read(report, PERSON_ELEMENTS), address: address(PATIENT_ADDRESS) },
    pickup: location('eScene.13', 'eScene.09', SCENE_ADDRESS),
    destination: location('eDisposition.01', 'eDisposition.21', DESTINATION_ADDRESS),
    ...read(report, CLINICAL_ELEMENTS),
    medications: readGroups(report, 'eMedications.MedicationGroup', MEDICATION, 'eMedications.03'),
    procedures: readGroups(report, 'eProcedures.ProcedureGroup', PROCEDURE, 'eProcedures.03'),
    vitals: readGroups(report, 'eVitals.VitalGroup', VITAL),
    payment: read(report, PAYMENT.elements),
    insurances: readGroups(report, 'ePayment.InsuranceGroup', INSURANCE),
    signatures: readGroups(report, 'eOther.SignatureGroup', SIGNATURE),
    crew: readGroups(report, 'eCrew.CrewGroup', CREW_MEMBER),
    narrative: text('eNarrative.01'),
    attachments: fileGroups(report).map((g, i) => ({
      ...read(g, ATTACHMENT_ELEMENTS),
      file: files[i] ?? null
    }))
  };
};
