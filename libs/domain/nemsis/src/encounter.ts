import {
  isRecord,
  type Json,
  type Model,
  modelType,
  nameLabel,
  type ValueType
} from '@ugula/graph';
import { elementLabel } from './elements.ts';
import { BLOB } from './reports.ts';

type Element = { name: string; element: string; type: ValueType };

type Fields = Record<string, Json>;

type Part = {
  key: string;
  name: string;
  title: string;
  description: string;
  elements: readonly Element[];
};

const CATEGORY = 'Encounter';

const el = (name: string, element: string, type: ValueType = 'string'): Element => ({
  name,
  element,
  type
});

const coded = (name: string, element: string, kind: string) => el(name, element, { code: kind });

const codedList = (name: string, element: string, kind: string) =>
  el(name, element, { list: { code: kind } });

const fieldOf = (e: Element) => ({
  name: e.name,
  type: e.type,
  label: elementLabel(e.element) ?? nameLabel(e.name),
  description: `NEMSIS ${e.element}, as the report gives it.`
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

const field = (name: string, type: ValueType, label: string, description: string) => ({
  name,
  type,
  label,
  description
});

const ADDRESS_FIELDS = [
  field('line', 'string', 'Street Address', 'The street address.'),
  field('city', 'string', 'City', 'The city, named even when the report gave its code.'),
  field('county', 'string', 'County', 'The county, named even when the report gave its code.'),
  field('state', 'string', 'State', 'The state, named even when the report gave its code.'),
  field('postalCode', 'string', 'ZIP Code', 'The ZIP code.')
];

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
  coded('ageUnits', 'ePatient.16', 'ageUnits'),
  coded('sex', 'ePatient.25', 'sex'),
  coded('gender', 'ePatient.13', 'gender'),
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
    field('address', ADDRESS_TYPE, 'Home Address', 'Where the patient lives.')
  ]
};

const SCENE: Model = {
  key: 'scene',
  name: 'scene',
  title: 'Scene',
  category: CATEGORY,
  description: 'where the patient was picked up: its name, type of location and address',
  fields: [
    field('name', 'string', 'Name', 'The facility or location name, NEMSIS eScene.13.'),
    field(
      'type',
      { code: 'locationType' },
      'Location Type',
      'The type of location, NEMSIS eScene.09.'
    ),
    field('address', ADDRESS_TYPE, 'Address', 'Where the patient was picked up.')
  ]
};

const DESTINATION: Model = {
  key: 'destination',
  name: 'destination',
  title: 'Destination',
  category: CATEGORY,
  description: 'where the patient was taken: its name, type of destination and address',
  fields: [
    field('name', 'string', 'Name', 'The destination name, NEMSIS eDisposition.01.'),
    field(
      'type',
      { code: 'destinationType' },
      'Destination Type',
      'The type of destination, NEMSIS eDisposition.21.'
    ),
    field('address', ADDRESS_TYPE, 'Address', 'Where the patient was taken.')
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
    coded('method', 'ePayment.01', 'paymentMethod'),
    coded('certification', 'ePayment.02', 'yesNo'),
    el('certificationDate', 'ePayment.03'),
    coded('certificationReason', 'ePayment.04', 'certificationReason'),
    coded('transportReason', 'ePayment.44', 'transportReason'),
    codedList('ambulanceConditions', 'ePayment.47', 'ambulanceCondition'),
    el('closestFacilityMiles', 'ePayment.48', 'number'),
    coded('alsAssessment', 'ePayment.49', 'yesNo'),
    coded('serviceLevel', 'ePayment.50', 'cmsServiceLevel'),
    codedList('conditionCodes', 'ePayment.51', 'conditionCode'),
    codedList('transportIndicators', 'ePayment.52', 'transportIndicator'),
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
    coded('priority', 'ePayment.11', 'billingPriority'),
    el('groupId', 'ePayment.17'),
    el('memberId', 'ePayment.18'),
    el('insuredLastName', 'ePayment.19'),
    el('insuredFirstName', 'ePayment.20'),
    coded('relationship', 'ePayment.22', 'relationship')
  ]
};

const MEDICATION: Part = {
  key: 'medication',
  name: 'medication',
  title: 'Medication',
  description: 'one medication the crew gave',
  elements: [
    el('givenAt', 'eMedications.01', 'datetime'),
    coded('code', 'eMedications.03', 'rxnorm'),
    coded('route', 'eMedications.04', 'medicationRoute'),
    el('dosage', 'eMedications.05', 'number'),
    coded('dosageUnits', 'eMedications.06', 'dosageUnits')
  ]
};

const PROCEDURE: Part = {
  key: 'procedure',
  name: 'procedure',
  title: 'Procedure',
  description: 'one procedure the crew performed',
  elements: [
    el('performedAt', 'eProcedures.01', 'datetime'),
    coded('code', 'eProcedures.03', 'snomed')
  ]
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
    coded('signer', 'eOther.12', 'signerType'),
    codedList('reasons', 'eOther.13', 'signatureReason'),
    el('representative', 'eOther.14'),
    coded('status', 'eOther.15', 'signatureStatus'),
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
  elements: [
    el('id', 'eCrew.01'),
    coded('level', 'eCrew.02', 'crewLevel'),
    coded('role', 'eCrew.03', 'crewRole')
  ]
};

const ATTACHMENT_ELEMENTS = [
  coded('documentType', 'eOther.09', 'documentType'),
  el('fileType', 'eOther.10'),
  el('name', 'eOther.22')
];

const ATTACHMENT: Model = {
  key: 'attachment',
  name: 'attachment',
  title: 'Attachment',
  category: CATEGORY,
  description: 'one file attached to the report, such as a facesheet or a physician certification',
  fields: [
    ...ATTACHMENT_ELEMENTS.map(fieldOf),
    field('file', BLOB, 'Stored File', 'Where the attached file is stored.')
  ]
};

const typeOf = (p: Part) => modelType(partModel(p));

const listOf = (t: ValueType): ValueType => ({ list: t });

const TRIP_ELEMENTS = [
  el('incidentNumber', 'eResponse.03'),
  coded('serviceType', 'eResponse.05', 'serviceType'),
  el('unitNumber', 'eResponse.13'),
  el('callSign', 'eResponse.14'),
  coded('responseMode', 'eResponse.23', 'responseMode'),
  codedList('responseModifiers', 'eResponse.24', 'responseModifier'),
  coded('incidentDisposition', 'eDisposition.12', 'incidentDisposition'),
  coded('unitDisposition', 'eDisposition.27', 'unitDisposition'),
  coded('patientEvaluation', 'eDisposition.28', 'patientEvaluation'),
  coded('crewDisposition', 'eDisposition.29', 'crewDisposition'),
  coded('transportDisposition', 'eDisposition.30', 'transportDisposition'),
  coded('levelOfCare', 'eDisposition.32', 'levelOfCare'),
  coded('transportMode', 'eDisposition.17', 'transportMode'),
  codedList('destinationReasons', 'eDisposition.20', 'destinationReason'),
  coded('patientsAtScene', 'eScene.06', 'patientsAtScene'),
  el('patientsTransported', 'eDisposition.11', 'integer')
];

const CLINICAL_ELEMENTS = [
  el('complaint', 'eSituation.04'),
  coded('primarySymptom', 'eSituation.09', 'icd10'),
  codedList('otherSymptoms', 'eSituation.10', 'icd10'),
  coded('primaryImpression', 'eSituation.11', 'icd10'),
  codedList('secondaryImpressions', 'eSituation.12', 'icd10'),
  coded('workRelated', 'eSituation.14', 'yesNo'),
  codedList('injuryCauses', 'eInjury.01', 'icd10'),
  coded('cardiacArrest', 'eArrest.01', 'cardiacArrest'),
  coded('arrestOutcome', 'eArrest.18', 'arrestOutcome')
];

export const ENCOUNTER: Model = {
  key: 'encounter',
  name: 'encounter',
  title: 'Encounter',
  category: CATEGORY,
  description:
    'one patient care report: the trip, the patient, the care given and the billing details',
  fields: [
    field('id', { id: 'encounter' }, 'Encounter', 'The encounter, once saved.'),
    field(
      'pcrNumber',
      'string',
      'PCR Number',
      'The patient care report number, NEMSIS eRecord.01.'
    ),
    field('revision', 'integer', 'Revision', 'Which copy this is, 1 for the first one received.'),
    field('reportId', { id: 'report' }, 'PCR', 'The patient care report this copy was read from.'),
    ...TRIP_ELEMENTS.map(fieldOf),
    field(
      'times',
      typeOf(TIMES),
      'Times',
      'The times of the trip, from the call to back in service.'
    ),
    field('odometer', typeOf(ODOMETER), 'Odometer', 'The odometer at each point of the trip.'),
    field('patient', modelType(PERSON), 'Patient', 'The patient as the report names them.'),
    field('pickup', modelType(SCENE), 'Pickup', 'Where the patient was picked up.'),
    field('destination', modelType(DESTINATION), 'Destination', 'Where the patient was taken.'),
    ...CLINICAL_ELEMENTS.map(fieldOf),
    field(
      'medications',
      listOf(typeOf(MEDICATION)),
      'Medications',
      'Each medication the crew gave.'
    ),
    field(
      'procedures',
      listOf(typeOf(PROCEDURE)),
      'Procedures',
      'Each procedure the crew performed.'
    ),
    field('vitals', listOf(typeOf(VITAL)), 'Vital Signs', 'Each set of vital signs taken.'),
    field('payment', typeOf(PAYMENT), 'Payment', 'How the trip is paid for and why it was needed.'),
    field(
      'insurances',
      listOf(typeOf(INSURANCE)),
      'Insurances',
      'Each insurance as the report gives it, before it is matched to a payer.'
    ),
    field(
      'signatures',
      listOf(typeOf(SIGNATURE)),
      'Signatures',
      'Each signature collected or attempted.'
    ),
    field('crew', listOf(typeOf(CREW_MEMBER)), 'Crew', 'Each member of the crew.'),
    field('narrative', 'string', 'Narrative', 'The crew narrative, NEMSIS eNarrative.01.'),
    field(
      'attachments',
      listOf(modelType(ATTACHMENT)),
      'Attachments',
      'Each file attached to the report.'
    )
  ]
};

export const ENCOUNTER_TYPE = modelType(ENCOUNTER);

export const encounterModels: Model[] = [
  ENCOUNTER,
  partModel(TIMES),
  partModel(ODOMETER),
  PERSON,
  ADDRESS,
  SCENE,
  DESTINATION,
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

const elementValue = (x: unknown, { element, type }: Element): Json => {
  const found = find(x, element);
  const texts = (Array.isArray(found) ? found : [found]).map(textOf);
  const first = texts.find((t) => t !== null) ?? null;
  if (typeof type === 'object' && 'list' in type) {
    return texts.filter((t): t is string => t !== null);
  }
  if (type === 'number') return numberOf(first);
  if (type === 'integer') {
    const n = numberOf(first);
    return n !== null && Number.isInteger(n) ? n : null;
  }
  return first;
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
