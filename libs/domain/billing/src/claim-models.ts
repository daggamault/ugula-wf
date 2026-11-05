import { BLOB, f, model } from './model-kit.ts';
import { COVERAGE, DEMOGRAPHICS, LOCATION } from './party-models.ts';

export const SERVICE = model(
  'billing.service',
  'service',
  'Service',
  'the level of service, emergency status and loaded miles of a trip, with the reasons',
  [
    f('level', 'string', 'Level of service (BLS, ALS1, ALS2, SCT)'),
    f('emergency', 'boolean', 'Emergency response'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('basis', { list: 'string' }, 'Reasons'),
    f('deceased', 'boolean', 'Pronounced dead before loading (QL)'),
    f('nonCoveredMiles', 'number', 'Miles beyond the nearest appropriate facility (A0888)')
  ]
);

export const FINDINGS = model(
  'billing.findings',
  'findings',
  'Narrative Findings',
  'what the language model read in a PCR narrative',
  [
    f(
      'medications',
      { list: { object: { medication: 'string', route: 'string', doses: 'integer' } } },
      'Medication doses'
    ),
    f('procedures', { list: 'string' }, 'ALS2 procedures'),
    f('ivDoses', 'integer', 'IV/IO medication doses'),
    f('notes', { list: 'string' }, 'What limited the reading')
  ]
);

export const LINE = model('billing.line', 'line', 'Claim Line', 'one HCPCS charge line', [
  f('code', 'string', 'HCPCS code'),
  f('units', 'number', 'Units'),
  f('unitCents', 'integer', 'Unit price (cents)'),
  f('totalCents', 'integer', 'Line total (cents)')
]);

export const DOCUMENTATION = model(
  'billing.documentation',
  'documentation',
  'Documentation',
  'what the report documents for billing: signature, physician certification, transport reason, conditions, weight and trip times',
  [
    f('signature', 'string', 'Billing signature (signed, exception, refused or missing)'),
    f('signatureNote', 'string', 'Why the patient did not sign, or who signed'),
    f('pcsOnFile', 'boolean', 'Physician certification statement on file'),
    f('pcsSignedOn', 'string', 'Physician certification statement signed on (YYYY-MM-DD)'),
    f('transportReason', 'string', 'Ambulance transport reason (A to E)'),
    f('conditionCodes', { list: 'string' }, 'Ambulance condition codes'),
    f('priorAuthorization', 'string', 'Prior authorization number'),
    f('weightKg', 'number', 'Patient weight (kg)'),
    f('atScene', 'string', 'Arrived on scene'),
    f('leftScene', 'string', 'Left the scene'),
    f('atDestination', 'string', 'Arrived at the destination'),
    f('patientCount', 'integer', 'Patients transported on the trip'),
    f('closestFacilityMiles', 'number', 'Miles to the closest hospital'),
    f('abnOnFile', 'boolean', 'Advance Beneficiary Notice on file'),
    f('abnSignedOn', 'string', 'Advance Beneficiary Notice signed on (YYYY-MM-DD)'),
    f('denialExpected', 'boolean', 'Medicare is expected to deny the transport'),
    f('mspEmployerPlan', 'boolean', 'MSP: group health plan from current employment'),
    f('mspEsrd', 'boolean', 'MSP: end-stage renal disease coordination period'),
    f('mspDisability', 'boolean', 'MSP: disabled with a large group health plan'),
    f(
      'mspAccident',
      'string',
      'MSP: accident or work injury (none, liability, noFault, workersComp)'
    ),
    f('priorAuthorizationExpiresOn', 'string', 'Prior authorization expires on (YYYY-MM-DD)'),
    f('pcsType', 'string', 'Physician certification type (repetitive or nonRepetitive)'),
    f('roundTrips', 'integer', 'Round trips in the repetitive series'),
    f('admissionDate', 'string', 'Admission date (YYYY-MM-DD)'),
    f('facilityStay', 'string', 'Facility stay during the trip (none, inpatient or snf)')
  ]
);

export const TRIP_FACTS = model(
  'billing.trip-facts',
  'trip',
  'Trip Facts',
  'the trip as the report records it: dispositions, type of service, response, level of care and odometers',
  [
    f('pcrNumber', 'string', 'PCR number · eRecord.01'),
    f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)'),
    f('calledAt', 'string', 'Call time · eTimes.01'),
    f('serviceType', 'string', 'Type of service requested · eResponse.05'),
    f('responseMode', 'string', 'Response mode to scene · eResponse.23'),
    f('incidentDisposition', 'string', 'Incident/patient disposition · eDisposition.12'),
    f('unitDisposition', 'string', 'Unit disposition · eDisposition.27'),
    f('patientEvaluation', 'string', 'Patient evaluation/care · eDisposition.28'),
    f('transportDisposition', 'string', 'Transport disposition · eDisposition.30'),
    f('levelOfCare', 'string', 'Level of care provided · eDisposition.32'),
    f('arrestOutcome', 'string', 'End of the cardiac arrest event · eArrest.18'),
    f('cmsServiceLevel', 'string', 'CMS service level · ePayment.50'),
    f('alsAssessment', 'string', 'ALS assessment performed and warranted · ePayment.49'),
    f('sceneOdometer', 'number', 'Odometer at the scene · eResponse.20'),
    f('destinationOdometer', 'number', 'Odometer at the destination · eResponse.21')
  ]
);

export const LOCATION_FACTS = model(
  'billing.location-facts',
  'locations',
  'Location Facts',
  'where the trip started and ended, and what kind of places they are',
  [
    f('pickup', LOCATION.type, 'Pickup'),
    f('destination', LOCATION.type, 'Destination'),
    f('pickupType', 'string', 'Incident location type · eScene.09'),
    f('destinationType', 'string', 'Type of destination · eDisposition.21'),
    f('destinationReason', 'string', 'Main reason for choosing the destination · eDisposition.20')
  ]
);

export const CLINICAL_FACTS = model(
  'billing.clinical-facts',
  'clinical',
  'Clinical Facts',
  'what the crew found and did: impressions, coded medications and procedures, and the narrative',
  [
    f('primaryImpression', 'string', 'Primary impression · eSituation.11'),
    f('secondaryImpressions', { list: 'string' }, 'Secondary impressions · eSituation.12'),
    f(
      'medications',
      { list: { object: { medication: 'string', route: 'string' } } },
      'Medications given (RxNorm and route) · eMedications.03, .04'
    ),
    f(
      'procedures',
      { list: { object: { procedure: 'string' } } },
      'Procedures performed (SNOMED CT) · eProcedures.03'
    ),
    f('narrative', 'string', 'Narrative · eNarrative.01')
  ]
);

export const ENCOUNTER_FACTS = model(
  'billing.encounter-facts',
  'facts',
  'Encounter Facts',
  'one normalized snapshot of a patient care report that every billing rule reads instead of NEMSIS sections',
  [
    f('trip', TRIP_FACTS.type, 'Trip'),
    f('locations', LOCATION_FACTS.type, 'Locations'),
    f('patient', DEMOGRAPHICS.type, 'Patient'),
    f('clinical', CLINICAL_FACTS.type, 'Clinical'),
    f('documentation', DOCUMENTATION.type, 'Documentation'),
    f('coverages', { list: COVERAGE.type }, 'Coverages as reported'),
    f('paymentMethod', 'string', 'Primary method of payment · ePayment.01')
  ]
);

export const CLAIM = model('billing.claim', 'claim', 'Claim', 'a claim before it is saved', [
  f('pcrNumber', 'string', 'PCR number'),
  f('patientId', 'string', 'Patient ID'),
  f('tripType', 'string', 'Trip type'),
  f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)'),
  f('level', 'string', 'Level of service'),
  f('emergency', 'boolean', 'Emergency response'),
  f('loadedMiles', 'number', 'Loaded miles'),
  f('deceased', 'boolean', 'Pronounced dead before loading (QL)'),
  f('nonCoveredMiles', 'number', 'Miles beyond the nearest appropriate facility (A0888)'),
  f('lines', { list: LINE.type }, 'Priced lines'),
  f('totalCents', 'integer', 'Total (cents)'),
  f('coverages', { list: COVERAGE.type }, 'Payers in billing order'),
  f('pickup', LOCATION.type, 'Pickup'),
  f('destination', LOCATION.type, 'Destination'),
  f('diagnoses', { list: 'string' }, 'ICD-10 diagnoses'),
  f('originDestination', 'string', 'Origin/destination modifier'),
  f('documentation', DOCUMENTATION.type, 'Documentation'),
  f('report', BLOB, 'Source report')
]);
