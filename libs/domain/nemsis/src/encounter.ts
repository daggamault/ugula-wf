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

type AddressElements = {
  line: string;
  city: string;
  county?: string;
  state: string;
  zip: string;
  country: string;
};

const addressOf = (a: AddressElements) => [
  el('line', a.line),
  el('city', a.city),
  ...(a.county ? [el('county', a.county)] : []),
  el('state', a.state),
  el('postalCode', a.zip),
  el('country', a.country)
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
  field('postalCode', 'string', 'ZIP Code', 'The ZIP code.'),
  field('country', 'string', 'Country', 'The country code.')
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

const PATIENT_ADDRESS = addressOf({
  line: 'ePatient.05',
  city: 'ePatient.06',
  county: 'ePatient.07',
  state: 'ePatient.08',
  zip: 'ePatient.09',
  country: 'ePatient.10'
});

const SCENE_ADDRESS = addressOf({
  line: 'eScene.15',
  city: 'eScene.17',
  county: 'eScene.21',
  state: 'eScene.18',
  zip: 'eScene.19',
  country: 'eScene.22'
});

const DESTINATION_ADDRESS = addressOf({
  line: 'eDisposition.03',
  city: 'eDisposition.04',
  county: 'eDisposition.06',
  state: 'eDisposition.05',
  zip: 'eDisposition.07',
  country: 'eDisposition.08'
});

const INSURER_ADDRESS = addressOf({
  line: 'ePayment.12',
  city: 'ePayment.13',
  state: 'ePayment.14',
  zip: 'ePayment.15',
  country: 'ePayment.16'
});

const RELATIVE_ADDRESS = addressOf({
  line: 'ePayment.26',
  city: 'ePayment.27',
  state: 'ePayment.28',
  zip: 'ePayment.29',
  country: 'ePayment.30'
});

const EMPLOYER_ADDRESS = addressOf({
  line: 'ePayment.34',
  city: 'ePayment.35',
  state: 'ePayment.36',
  zip: 'ePayment.37',
  country: 'ePayment.38'
});

const PERSON_ELEMENTS = [
  el('patientId', 'ePatient.01'),
  el('firstName', 'ePatient.03'),
  el('middleName', 'ePatient.04'),
  el('lastName', 'ePatient.02'),
  el('suffix', 'ePatient.23'),
  el('birthDate', 'ePatient.17'),
  el('ssn', 'ePatient.12'),
  el('age', 'ePatient.15', 'integer'),
  coded('ageUnits', 'ePatient.16', 'ageUnits'),
  coded('sex', 'ePatient.25', 'sex'),
  coded('gender', 'ePatient.13', 'gender'),
  codedList('races', 'ePatient.14', 'race'),
  el('phone', 'ePatient.18'),
  el('email', 'ePatient.19'),
  el('driversLicenseState', 'ePatient.20'),
  el('driversLicenseNumber', 'ePatient.21'),
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
    field('code', 'string', 'Facility Code', 'The facility code, NEMSIS eScene.10.'),
    field(
      'type',
      { code: 'locationType' },
      'Location Type',
      'The type of location, NEMSIS eScene.09.'
    ),
    field('address', ADDRESS_TYPE, 'Address', 'Where the patient was picked up.'),
    field(
      'room',
      'string',
      'Apartment, Suite or Room',
      'The apartment, suite or room, NEMSIS eScene.16.'
    ),
    field(
      'mileMarker',
      'string',
      'Mile Post or Roadway',
      'The mile post or major roadway, NEMSIS eScene.14.'
    ),
    field('gps', 'string', 'GPS Location', 'The scene GPS location, NEMSIS eScene.11.')
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
      'code',
      'string',
      'Facility Code',
      'The destination facility code, NEMSIS eDisposition.02.'
    ),
    field(
      'type',
      { code: 'destinationType' },
      'Destination Type',
      'The type of destination, NEMSIS eDisposition.21.'
    ),
    field('address', ADDRESS_TYPE, 'Address', 'Where the patient was taken.'),
    field('gps', 'string', 'GPS Location', 'The destination GPS location, NEMSIS eDisposition.09.'),
    field(
      'department',
      { code: 'hospitalDepartment' },
      'Hospital Department',
      'The in-patient department the patient was taken to, NEMSIS eDisposition.22.'
    ),
    field(
      'capabilities',
      { list: { code: 'hospitalCapability' } },
      'Hospital Capabilities',
      'What the destination is designated for, NEMSIS eDisposition.23.'
    )
  ]
};

const TIMES: Part = {
  key: 'times',
  name: 'times',
  title: 'Times',
  description: 'the times of a trip, from the call to back in service',
  elements: [
    el('call', 'eTimes.01', 'datetime'),
    el('dispatchNotified', 'eTimes.02', 'datetime'),
    el('unitNotified', 'eTimes.03', 'datetime'),
    el('dispatchAcknowledged', 'eTimes.04', 'datetime'),
    el('enRoute', 'eTimes.05', 'datetime'),
    el('atScene', 'eTimes.06', 'datetime'),
    el('atPatient', 'eTimes.07', 'datetime'),
    el('transferOfEmsCare', 'eTimes.08', 'datetime'),
    el('leftScene', 'eTimes.09', 'datetime'),
    el('atLandingArea', 'eTimes.10', 'datetime'),
    el('atDestination', 'eTimes.11', 'datetime'),
    el('transferOfCare', 'eTimes.12', 'datetime'),
    el('backInService', 'eTimes.13', 'datetime'),
    el('canceled', 'eTimes.14', 'datetime'),
    el('backAtHome', 'eTimes.15', 'datetime'),
    el('callCompleted', 'eTimes.16', 'datetime')
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
    'what the report records for billing: payment method, physician certification, transport reason, conditions and employer',
  elements: [
    coded('method', 'ePayment.01', 'paymentMethod'),
    coded('certification', 'ePayment.02', 'yesNoUnknown'),
    el('certificationDate', 'ePayment.03'),
    codedList('certificationReasons', 'ePayment.04', 'certificationReason'),
    coded('certifierType', 'ePayment.05', 'certifierType'),
    el('certifierLastName', 'ePayment.06'),
    el('certifierFirstName', 'ePayment.07'),
    coded('residency', 'ePayment.08', 'residency'),
    coded('responseUrgency', 'ePayment.40', 'responseUrgency'),
    codedList('transportAssessments', 'ePayment.41', 'transportAssessment'),
    coded('sctProvider', 'ePayment.42', 'sctProvider'),
    coded('transportReason', 'ePayment.44', 'transportReason'),
    el('roundTripPurpose', 'ePayment.45'),
    el('stretcherPurpose', 'ePayment.46'),
    codedList('ambulanceConditions', 'ePayment.47', 'ambulanceCondition'),
    el('closestFacilityMiles', 'ePayment.48', 'number'),
    coded('alsAssessment', 'ePayment.49', 'yesNo'),
    coded('serviceLevel', 'ePayment.50', 'cmsServiceLevel'),
    codedList('conditionCodes', 'ePayment.51', 'conditionCode'),
    codedList('transportIndicators', 'ePayment.52', 'transportIndicator'),
    el('priorAuthorization', 'ePayment.53'),
    el('priorAuthorizationPayer', 'ePayment.54'),
    el('employer', 'ePayment.33'),
    el('employerPhone', 'ePayment.39')
  ]
};

const INSURANCE_ELEMENTS = [
  el('companyId', 'ePayment.09'),
  el('companyName', 'ePayment.10'),
  el('companyPhone', 'ePayment.59'),
  coded('priority', 'ePayment.11', 'billingPriority'),
  coded('payerType', 'ePayment.57', 'payerType'),
  el('groupId', 'ePayment.17'),
  el('groupName', 'ePayment.58'),
  el('memberId', 'ePayment.18'),
  el('insuredLastName', 'ePayment.19'),
  el('insuredFirstName', 'ePayment.20'),
  el('insuredMiddleName', 'ePayment.21'),
  el('insuredBirthDate', 'ePayment.60'),
  coded('relationship', 'ePayment.22', 'relationship')
];

const INSURANCE: Model = {
  key: 'insurance',
  name: 'insurance',
  title: 'Insurance',
  category: CATEGORY,
  description: 'one insurance as the report gives it, before it is matched to a payer',
  fields: [
    ...INSURANCE_ELEMENTS.map(fieldOf),
    field(
      'companyAddress',
      ADDRESS_TYPE,
      'Insurance Company Address',
      'Where the insurance company is.'
    )
  ]
};

const MEDICATION: Part = {
  key: 'medication',
  name: 'medication',
  title: 'Medication',
  description: 'one medication the crew gave',
  elements: [
    el('givenAt', 'eMedications.01', 'datetime'),
    coded('priorToCare', 'eMedications.02', 'yesNo'),
    coded('byAnotherUnit', 'eMedications.13', 'yesNo'),
    coded('code', 'eMedications.03', 'rxnorm'),
    coded('route', 'eMedications.04', 'medicationRoute'),
    el('dosage', 'eMedications.05', 'number'),
    coded('dosageUnits', 'eMedications.06', 'dosageUnits'),
    coded('response', 'eMedications.07', 'careResponse'),
    codedList('complications', 'eMedications.08', 'medicationComplication'),
    el('crewId', 'eMedications.09'),
    coded('givenBy', 'eMedications.10', 'providerType')
  ]
};

const PROCEDURE: Part = {
  key: 'procedure',
  name: 'procedure',
  title: 'Procedure',
  description: 'one procedure the crew performed',
  elements: [
    el('performedAt', 'eProcedures.01', 'datetime'),
    coded('priorToCare', 'eProcedures.02', 'yesNo'),
    coded('byAnotherUnit', 'eProcedures.15', 'yesNo'),
    coded('code', 'eProcedures.03', 'snomed'),
    el('attempts', 'eProcedures.05', 'integer'),
    coded('successful', 'eProcedures.06', 'yesNo'),
    codedList('complications', 'eProcedures.07', 'procedureComplication'),
    coded('response', 'eProcedures.08', 'careResponse'),
    el('crewId', 'eProcedures.09'),
    coded('performedBy', 'eProcedures.10', 'providerType')
  ]
};

const VITAL: Part = {
  key: 'vital',
  name: 'vital',
  title: 'Vital Signs',
  description: 'one set of vital signs',
  elements: [
    el('takenAt', 'eVitals.01', 'datetime'),
    coded('priorToCare', 'eVitals.02', 'yesNo'),
    codedList('cardiacRhythm', 'eVitals.03', 'cardiacRhythm'),
    coded('ecgType', 'eVitals.04', 'ecgType'),
    el('systolic', 'eVitals.06', 'number'),
    el('diastolic', 'eVitals.07', 'number'),
    el('heartRate', 'eVitals.10', 'number'),
    el('pulseOximetry', 'eVitals.12', 'number'),
    el('respiratoryRate', 'eVitals.14', 'number'),
    el('endTidalCo2', 'eVitals.16', 'number'),
    el('bloodGlucose', 'eVitals.18', 'number'),
    coded('gcsEye', 'eVitals.19', 'gcsEye'),
    coded('gcsVerbal', 'eVitals.20', 'gcsVerbal'),
    coded('gcsMotor', 'eVitals.21', 'gcsMotor'),
    el('glasgowComaScore', 'eVitals.23', 'number'),
    el('temperature', 'eVitals.24', 'number'),
    coded('responsiveness', 'eVitals.26', 'responsiveness'),
    el('painScore', 'eVitals.27', 'integer'),
    coded('strokeScale', 'eVitals.29', 'strokeScale')
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

const RELATIVE_ELEMENTS = [
  el('lastName', 'ePayment.23'),
  el('firstName', 'ePayment.24'),
  el('middleName', 'ePayment.25'),
  el('phone', 'ePayment.31'),
  coded('relationship', 'ePayment.32', 'relativeRelationship')
];

const RELATIVE: Model = {
  key: 'relative',
  name: 'relative',
  title: 'Closest Relative or Guardian',
  category: CATEGORY,
  description: 'the closest relative or guardian of the patient',
  fields: [
    ...RELATIVE_ELEMENTS.map(fieldOf),
    field('address', ADDRESS_TYPE, 'Address', 'Where the relative or guardian lives.')
  ]
};

const SUPPLY: Part = {
  key: 'supply',
  name: 'supply',
  title: 'Supply',
  description: 'one supply item used on the trip',
  elements: [el('name', 'ePayment.55'), el('quantity', 'ePayment.56', 'integer')]
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
  el('agencyNumber', 'eResponse.01'),
  el('agencyName', 'eResponse.02'),
  el('incidentNumber', 'eResponse.03'),
  el('responseNumber', 'eResponse.04'),
  coded('serviceType', 'eResponse.05', 'serviceType'),
  codedList('unitCapabilities', 'eResponse.07', 'unitCapability'),
  el('unitNumber', 'eResponse.13'),
  el('callSign', 'eResponse.14'),
  coded('unitLevel', 'eResponse.15', 'unitLevel'),
  coded('dispatchReason', 'eDispatch.01', 'dispatchReason'),
  coded('emdPerformed', 'eDispatch.02', 'emdPerformed'),
  el('emdCode', 'eDispatch.03'),
  coded('dispatchPriority', 'eDispatch.05', 'dispatchPriority'),
  coded('responseMode', 'eResponse.23', 'responseMode'),
  codedList('responseModifiers', 'eResponse.24', 'responseModifier'),
  coded('incidentDisposition', 'eDisposition.12', 'incidentDisposition'),
  coded('unitDisposition', 'eDisposition.27', 'unitDisposition'),
  coded('patientEvaluation', 'eDisposition.28', 'patientEvaluation'),
  coded('crewDisposition', 'eDisposition.29', 'crewDisposition'),
  coded('transportDisposition', 'eDisposition.30', 'transportDisposition'),
  codedList('refusalReasons', 'eDisposition.31', 'refusalReason'),
  coded('levelOfCare', 'eDisposition.32', 'levelOfCare'),
  coded('transportMethod', 'eDisposition.16', 'transportMethod'),
  coded('transportMode', 'eDisposition.17', 'transportMode'),
  codedList('transportModifiers', 'eDisposition.18', 'transportModifier'),
  codedList('movedToAmbulance', 'eDisposition.13', 'patientMovement'),
  codedList('transportPositions', 'eDisposition.14', 'transportPosition'),
  codedList('movedFromAmbulance', 'eDisposition.15', 'patientMovement'),
  coded('releaseAcuity', 'eDisposition.19', 'releaseAcuity'),
  codedList('destinationReasons', 'eDisposition.20', 'destinationReason'),
  coded('patientsAtScene', 'eScene.06', 'patientsAtScene'),
  el('patientsTransported', 'eDisposition.11', 'integer')
];

const CLINICAL_ELEMENTS = [
  el('symptomOnset', 'eSituation.01', 'datetime'),
  coded('possibleInjury', 'eSituation.02', 'yesNoUnknown'),
  el('complaint', 'eSituation.04'),
  coded('primarySymptom', 'eSituation.09', 'icd10'),
  codedList('otherSymptoms', 'eSituation.10', 'icd10'),
  coded('primaryImpression', 'eSituation.11', 'icd10'),
  codedList('secondaryImpressions', 'eSituation.12', 'icd10'),
  coded('initialAcuity', 'eSituation.13', 'initialAcuity'),
  coded('workRelated', 'eSituation.14', 'yesNoUnknown'),
  el('occupationalIndustry', 'eSituation.15'),
  el('occupation', 'eSituation.16'),
  codedList('transferJustifications', 'eSituation.19', 'icd10'),
  coded('transferReason', 'eSituation.20', 'transferReason'),
  codedList('injuryCauses', 'eInjury.01', 'icd10'),
  codedList('injuryMechanisms', 'eInjury.02', 'injuryMechanism'),
  codedList('careBarriers', 'eHistory.01', 'careBarrier'),
  codedList('medicalHistory', 'eHistory.08', 'icd10'),
  coded('cardiacArrest', 'eArrest.01', 'cardiacArrest'),
  codedList('resuscitation', 'eArrest.03', 'resuscitation'),
  codedList('resuscitationStopped', 'eArrest.16', 'resuscitationStopped'),
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
    field('supplies', listOf(typeOf(SUPPLY)), 'Supplies', 'Each supply item used on the trip.'),
    field('payment', typeOf(PAYMENT), 'Payment', 'How the trip is paid for and why it was needed.'),
    field(
      'insurances',
      listOf(modelType(INSURANCE)),
      'Insurances',
      'Each insurance as the report gives it, before it is matched to a payer.'
    ),
    field(
      'signatures',
      listOf(typeOf(SIGNATURE)),
      'Signatures',
      'Each signature collected or attempted.'
    ),
    field('employerAddress', ADDRESS_TYPE, 'Employer Address', 'Where the patient works.'),
    field(
      'relatives',
      listOf(modelType(RELATIVE)),
      'Closest Relatives or Guardians',
      'Each closest relative or guardian of the patient.'
    ),
    field('crew', listOf(typeOf(CREW_MEMBER)), 'Crew', 'Each member of the crew.'),
    field(
      'reportedBy',
      'string',
      'Report Completed By',
      'The crew member who completed the report, NEMSIS eOther.08.'
    ),
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

const codeKindOf = ({ type }: Element) =>
  typeof type === 'object' && 'code' in type
    ? type.code
    : typeof type === 'object' &&
        'list' in type &&
        typeof type.list === 'object' &&
        'code' in type.list
      ? type.list.code
      : null;

const SCENE_AND_DESTINATION_CODES: Readonly<Record<string, string>> = {
  destinationType: 'eDisposition.21',
  hospitalDepartment: 'eDisposition.22',
  hospitalCapability: 'eDisposition.23'
};

export const codeKindElements: Readonly<Record<string, string>> = {
  ...Object.fromEntries(
    [
      ...PERSON_ELEMENTS,
      ...[
        TIMES,
        ODOMETER,
        PAYMENT,
        MEDICATION,
        PROCEDURE,
        VITAL,
        SIGNATURE,
        CREW_MEMBER,
        SUPPLY
      ].flatMap((p) => p.elements),
      ...INSURANCE_ELEMENTS,
      ...RELATIVE_ELEMENTS,
      ...ATTACHMENT_ELEMENTS,
      ...TRIP_ELEMENTS,
      ...CLINICAL_ELEMENTS
    ].flatMap((e) => {
      const kind = codeKindOf(e);
      return kind && kind !== 'icd10' ? [[kind, e.element]] : [];
    })
  ),
  ...SCENE_AND_DESTINATION_CODES
};

export const encounterModels: Model[] = [
  ENCOUNTER,
  partModel(TIMES),
  partModel(ODOMETER),
  PERSON,
  ADDRESS,
  SCENE,
  DESTINATION,
  partModel(PAYMENT),
  INSURANCE,
  RELATIVE,
  ...[MEDICATION, PROCEDURE, VITAL, SUPPLY, SIGNATURE, CREW_MEMBER].map(partModel),
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

const NOT_VALUES = new Set(['7701001', '7701003', '7701005']);

const APPROXIMATE = '8801029';

const isNotValue = (x: unknown) =>
  isRecord(x) &&
  (Object.hasOwn(x, '@NV') || (Object.hasOwn(x, '@PN') && String(x['@PN']) !== APPROXIMATE));

const textOf = (x: unknown): string | null => {
  if (isNotValue(x)) return null;
  const raw = isRecord(x) ? x['#text'] : x;
  const text =
    typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? cleanText(raw) : '';
  return text && !NOT_VALUES.has(text) ? text : null;
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

const readAddressed = (
  report: unknown,
  group: string,
  elements: readonly Element[],
  addressElements: readonly Element[],
  addressName: string,
  names: PlaceNames
) =>
  groups(report, group).map((g) => ({
    ...read(g, elements),
    [addressName]: named(read(g, addressElements), names)
  }));

type PlaceNames = Readonly<Record<string, string>>;

const isPlaceCode = (x: Json | undefined): x is string => typeof x === 'string' && /^\d+$/.test(x);

const named = (address: Fields, names: PlaceNames): Fields =>
  isPlaceCode(address.city) ? { ...address, city: names[address.city] ?? null } : address;

const PLACE_ELEMENTS = [
  'ePatient.06',
  'eScene.17',
  'eDisposition.04',
  'ePayment.13',
  'ePayment.27',
  'ePayment.35'
];

const findAll = (x: unknown, key: string): unknown[] => {
  if (Array.isArray(x)) return x.flatMap((item) => findAll(item, key));
  if (!isRecord(x)) return [];
  if (Object.hasOwn(x, key)) return [x[key]].flat();
  return Object.entries(x).flatMap(([k, child]) => (k.startsWith('@') ? [] : findAll(child, key)));
};

const textsOf = (report: unknown, element: string) => findAll(report, element).map(textOf);

export const placeCodesOf = (report: unknown): string[] => [
  ...new Set(
    PLACE_ELEMENTS.flatMap((e) => textsOf(report, e)).filter((c): c is string => isPlaceCode(c))
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
  const list = (element: string) => elementValue(report, el(element, element, { list: 'string' }));
  return {
    id: null,
    pcrNumber: text('eRecord.01'),
    revision: null,
    reportId: null,
    ...read(report, TRIP_ELEMENTS),
    times: read(report, TIMES.elements),
    odometer: read(report, ODOMETER.elements),
    patient: { ...read(report, PERSON_ELEMENTS), address: address(PATIENT_ADDRESS) },
    pickup: {
      name: text('eScene.13'),
      code: text('eScene.10'),
      type: text('eScene.09'),
      address: address(SCENE_ADDRESS),
      room: text('eScene.16'),
      mileMarker: text('eScene.14'),
      gps: text('eScene.11')
    },
    destination: {
      name: text('eDisposition.01'),
      code: text('eDisposition.02'),
      type: text('eDisposition.21'),
      address: address(DESTINATION_ADDRESS),
      gps: text('eDisposition.09'),
      department: text('eDisposition.22'),
      capabilities: list('eDisposition.23')
    },
    ...read(report, CLINICAL_ELEMENTS),
    medications: readGroups(report, 'eMedications.MedicationGroup', MEDICATION, 'eMedications.03'),
    procedures: readGroups(report, 'eProcedures.ProcedureGroup', PROCEDURE, 'eProcedures.03'),
    vitals: readGroups(report, 'eVitals.VitalGroup', VITAL),
    supplies: readGroups(report, 'ePayment.SupplyItemGroup', SUPPLY),
    payment: read(report, PAYMENT.elements),
    insurances: readAddressed(
      report,
      'ePayment.InsuranceGroup',
      INSURANCE_ELEMENTS,
      INSURER_ADDRESS,
      'companyAddress',
      names
    ),
    employerAddress: address(EMPLOYER_ADDRESS),
    relatives: readAddressed(
      report,
      'ePayment.ClosestRelativeGroup',
      RELATIVE_ELEMENTS,
      RELATIVE_ADDRESS,
      'address',
      names
    ),
    signatures: readGroups(report, 'eOther.SignatureGroup', SIGNATURE),
    crew: readGroups(report, 'eCrew.CrewGroup', CREW_MEMBER),
    reportedBy: text('eOther.08'),
    narrative: text('eNarrative.01'),
    attachments: fileGroups(report).map((g, i) => ({
      ...read(g, ATTACHMENT_ELEMENTS),
      file: files[i] ?? null
    }))
  };
};
