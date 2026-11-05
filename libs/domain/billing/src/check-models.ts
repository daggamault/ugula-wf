import { f, model } from './model-kit.ts';

export const CLAIM_ISSUE = model(
  'billing.claim-issue',
  'issue',
  'Claim Issue',
  'something a claim is missing or that looks wrong, with the check that found it and the field it is fixed in',
  [
    f('code', 'string', 'Check code (the Check Severity table key)'),
    f('severity', 'string', 'Severity (blocking or warning)'),
    f('field', 'string', 'Field to fix'),
    f('message', 'string', 'Message'),
    f('coverageId', 'string', 'Coverage it is about')
  ]
);

export const CHECKED_PAYER = model(
  'billing.checked-payer',
  'payer',
  'Checked Payer',
  'what the claim checks know about one payer on the claim',
  [
    f('coverageId', 'string', 'Coverage ID'),
    f('name', 'string', 'Payer name'),
    f('linked', 'boolean', 'Linked to the payer directory with a claim filing indicator'),
    f('memberId', 'string', 'Member ID'),
    f('needsInsured', 'boolean', 'The patient is not the insured'),
    f('insuredLastName', 'string', 'Insured last name'),
    f('eligibility', 'string', 'Eligibility answer (active or inactive)'),
    f('eligibilityNote', 'string', 'What the eligibility answer said'),
    f('filingLimitDays', 'integer', 'Filing limit (days)'),
    f('filingDaysLeft', 'integer', 'Days left to file'),
    f('medicare', 'boolean', 'A Medicare payer (claim filing MA or MB)'),
    f('stayReported', 'string', 'Facility stay its 271 reports on the date of service')
  ]
);

export const FACILITY = model(
  'billing.facility',
  'facility',
  'Facility',
  'a facility from the agency facility directory, and whether the agency bills it under contract',
  [
    f('id', 'string', 'Facility ID'),
    f('name', 'string', 'Name'),
    f('kind', 'string', 'Kind (hospital, snf, dialysis or other)'),
    f('contract', 'boolean', 'The agency bills this facility for its transports under contract')
  ]
);

export const CHECK_FACTS = model(
  'billing.check-facts',
  'facts',
  'Check Facts',
  'what the claim checks read: the saved claim, its documentation and payers, with the date math done',
  [
    f('patientLinked', 'boolean', 'A patient is on the claim'),
    f('patientAddressMissing', { list: 'string' }, 'Missing parts of the patient address'),
    f('pcrNumber', 'string', 'PCR number'),
    f('serviceDate', 'string', 'Date of service'),
    f('tripType', 'string', 'Trip type'),
    f('transports', 'boolean', 'The patient was transported'),
    f('level', 'string', 'Level of service'),
    f('levelValid', 'boolean', 'The level of service is BLS, ALS1, ALS2 or SCT'),
    f('emergency', 'boolean', 'Emergency response'),
    f('lineCount', 'integer', 'Charge lines'),
    f('linesAddUp', 'boolean', 'The claim total is the sum of its lines'),
    f('diagnosisCount', 'integer', 'Diagnoses'),
    f('pickupMissing', { list: 'string' }, 'Missing parts of the pickup address'),
    f('destinationMissing', { list: 'string' }, 'Missing parts of the destination address'),
    f('originDestinationValid', 'boolean', 'The origin/destination modifier is valid'),
    f('transportReason', 'string', 'Ambulance transport reason'),
    f('timesRecorded', 'boolean', 'Left-scene and at-destination times are recorded'),
    f('timesInOrder', 'boolean', 'The trip times are in order'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('signature', 'string', 'Billing signature'),
    f('signatureNote', 'string', 'Why the patient did not sign, or who signed'),
    f('pcsOnFile', 'boolean', 'Physician certification statement on file'),
    f('pcsSignedOn', 'string', 'Physician certification statement signed on'),
    f('pcsDaysBeforeTrip', 'integer', 'Days the certification was signed before the trip'),
    f('billsMedicare', 'boolean', 'A Medicare payer is on the claim'),
    f('payers', { list: CHECKED_PAYER.type }, 'Payers, in billing order'),
    f('deceased', 'boolean', 'Pronounced dead before loading (QL)'),
    f('nonCoveredMiles', 'number', 'Miles beyond the nearest appropriate facility (A0888)'),
    f('patientCount', 'integer', 'Patients transported on the trip'),
    f('abnOnFile', 'boolean', 'Advance Beneficiary Notice on file'),
    f('abnSignedOn', 'string', 'Advance Beneficiary Notice signed on'),
    f('denialExpected', 'boolean', 'A biller expects Medicare to deny the transport'),
    f('mspEmployerPlan', 'boolean', 'MSP: group health plan from current employment'),
    f('mspEsrd', 'boolean', 'MSP: end-stage renal disease coordination period'),
    f('mspDisability', 'boolean', 'MSP: disabled with a large group health plan'),
    f(
      'mspAccident',
      'string',
      'MSP: accident or work injury (none, liability, noFault, workersComp)'
    ),
    f('priorAuthorization', 'string', 'Prior authorization number (UTN)'),
    f('priorAuthorizationDaysLeft', 'integer', 'Days the prior authorization runs past the trip'),
    f('pcsType', 'string', 'Physician certification type (repetitive or nonRepetitive)'),
    f('roundTrips', 'integer', 'Round trips in the repetitive series, as a biller confirmed'),
    f('facilityStay', 'string', 'Facility stay a biller confirmed (none, inpatient or snf)'),
    f('pickupFacility', FACILITY.type, 'Pickup facility in the directory'),
    f('destinationFacility', FACILITY.type, 'Destination facility in the directory'),
    f('responsibleParty', 'string', 'Who the claim is billed to (payer or facility)'),
    f('recordedParty', 'string', 'Who the claim was recorded as billed to, once decided'),
    f('documents', { list: 'string' }, 'Kinds of documents on file')
  ]
);

export const CLAIM_DOCUMENT = model(
  'billing.claim-document',
  'document',
  'Claim Document',
  'a document uploaded to a claim, such as a facesheet, certification, signature form, ABN or MSP form',
  [
    f('id', 'string', 'Document ID'),
    f('kind', 'string', 'Kind (facesheet, pcs, signature, abn or msp)'),
    f('signedOn', 'string', 'Signed on (YYYY-MM-DD)'),
    f('fileName', 'string', 'File name')
  ]
);
