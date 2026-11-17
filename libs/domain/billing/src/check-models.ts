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
    f('coverageId', { id: 'coverage' }, 'Coverage it is about')
  ]
);

export const CHECKED_PAYER = model(
  'billing.checked-payer',
  'payer',
  'Checked Payer',
  'what the claim checks know about one payer on the claim',
  [
    f('coverageId', { id: 'coverage' }, 'Coverage ID'),
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
    f('id', { id: 'facility' }, 'Facility ID'),
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
    f('classification', 'string', 'Classification'),
    f(
      'transports',
      'boolean',
      'The patient was transported (never when pronounced dead before loading)'
    ),
    f('level', 'string', 'Level of service'),
    f('levelValid', 'boolean', 'The level of service is BLS, ALS1, ALS2 or SCT'),
    f('emergency', 'boolean', 'Emergency response'),
    f('lineCount', 'integer', 'Charge lines'),
    f('linesAddUp', 'boolean', 'The claim total is the sum of its lines'),
    f('diagnosisCount', 'integer', 'Diagnoses'),
    f(
      'unknownDiagnoses',
      { list: 'string' },
      'Diagnoses that are not ICD-10-CM codes (checked for trips in the loaded code year)'
    ),
    f(
      'unbillableDiagnoses',
      { list: 'string' },
      'ICD-10-CM categories on the claim that need more characters to bill, with their meaning'
    ),
    f('pickupMissing', { list: 'string' }, 'Missing parts of the pickup address'),
    f(
      'pickupZipPriced',
      'boolean',
      'Medicare prices the pickup ZIP code (it is in the CMS ZIP file); empty without one'
    ),
    f(
      'pickupZipNeedsPlusFour',
      'boolean',
      'CMS splits the pickup ZIP code between localities and the claim has no ZIP+4'
    ),
    f(
      'zipStateMismatches',
      { list: 'string' },
      'Places (pickup, destination, patient) whose ZIP code is in another state'
    ),
    f('destinationMissing', { list: 'string' }, 'Missing parts of the destination address'),
    f('originDestinationValid', 'boolean', 'The origin/destination modifier is valid'),
    f('transportReason', 'string', 'Ambulance transport reason'),
    f('conditionsDocumented', 'boolean', 'The report documents ambulance conditions (CRC)'),
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
    f('mspDisability', 'boolean', 'MSP: disabled with a group health plan through employment'),
    f(
      'mspEmployerSize',
      'integer',
      'MSP: employees at the employer that sponsors the group health plan'
    ),
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

const ADDRESS_TYPE = {
  object: { addressLine: 'string', city: 'string', state: 'string', postalCode: 'string' }
} as const;

export const RECORDED_PAYER = model(
  'billing.recorded-payer',
  'payer',
  'Recorded Payer',
  'one payer on the claim as saved, before any check works anything out',
  [
    f('coverageId', { id: 'coverage' }, 'Coverage ID'),
    f('name', 'string', 'Payer name'),
    f('payerId', { id: 'payer' }, 'Payer in the directory'),
    f('claimFiling', 'string', 'Claim filing indicator'),
    f('memberId', 'string', 'Member ID'),
    f('relationship', 'string', 'Patient relationship to the insured (18 is self)'),
    f('insuredLastName', 'string', 'Insured last name'),
    f('filingLimitDays', 'integer', 'Filing limit the directory gives (days)'),
    f('eligibility', 'string', 'Eligibility answer (active or inactive)'),
    f('eligibilityNote', 'string', 'What the eligibility answer said'),
    f('stayKind', 'string', 'Facility stay its 271 reports (inpatient or snf)'),
    f('stayAdmittedOn', 'string', 'Reported stay admitted on (YYYY-MM-DD)'),
    f('stayDischargedOn', 'string', 'Reported stay discharged on (YYYY-MM-DD)')
  ]
);

export const RECORDED_DIAGNOSIS = model(
  'billing.recorded-diagnosis',
  'diagnosis',
  'Recorded Diagnosis',
  'one diagnosis on the claim with what the loaded ICD-10-CM code set says about it',
  [
    f('code', 'string', 'Code as written, such as R10.9'),
    f('description', 'string', 'Meaning, when the code set knows the code'),
    f('billable', 'boolean', 'Billable as is (not a category that needs more characters)')
  ]
);

export const CLAIM_RECORD = model(
  'billing.claim-record',
  'record',
  'Claim Record',
  'the saved claim as it is stored, with its documentation, places and payers, for the Check Facts rule to work out what the checks read',
  [
    f('today', 'string', 'Today in the time zone of the agency (YYYY-MM-DD)'),
    f('patientId', { id: 'patient' }, 'Patient'),
    f('patient', ADDRESS_TYPE, 'Patient mailing address'),
    f('pcrNumber', 'string', 'PCR number'),
    f('serviceDate', 'string', 'Date of service'),
    f('classification', 'string', 'Classification'),
    f('level', 'string', 'Level of service'),
    f('emergency', 'boolean', 'Emergency response'),
    f('lineCodes', { list: { code: 'hcpcs' } }, 'Charge line codes'),
    f('lineTotalCents', { list: 'integer' }, 'Charge line totals (cents)'),
    f('totalCents', 'integer', 'Claim total (cents)'),
    f('diagnosisCount', 'integer', 'Diagnoses on the claim'),
    f('diagnoses', { list: RECORDED_DIAGNOSIS.type }, 'Diagnoses with what the code set says'),
    f('pickup', ADDRESS_TYPE, 'Pickup address'),
    f('destination', ADDRESS_TYPE, 'Destination address'),
    f('pickupZipKnown', 'boolean', 'The CMS ZIP file lists the pickup ZIP code'),
    f('pickupZipSplit', 'boolean', 'CMS splits the pickup ZIP code between localities'),
    f('pickupZipState', 'string', 'State GeoNames gives the pickup ZIP code'),
    f('destinationZipState', 'string', 'State GeoNames gives the destination ZIP code'),
    f('patientZipState', 'string', 'State GeoNames gives the patient ZIP code'),
    f('originDestination', 'string', 'Origin/destination modifier, when valid'),
    f('transportReason', 'string', 'Ambulance transport reason'),
    f('conditionCodes', { list: 'string' }, 'Ambulance condition codes documented'),
    f('atScene', 'datetime', 'Arrived at the scene'),
    f('leftScene', 'datetime', 'Left the scene'),
    f('atDestination', 'datetime', 'Arrived at the destination'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('signature', 'string', 'Billing signature'),
    f('signatureNote', 'string', 'Why the patient did not sign, or who signed'),
    f('pcsOnFile', 'boolean', 'Physician certification statement on file'),
    f('pcsSignedOn', 'string', 'Physician certification statement signed on'),
    f('pcsType', 'string', 'Physician certification type (repetitive or nonRepetitive)'),
    f('roundTrips', 'integer', 'Round trips in the repetitive series'),
    f('priorAuthorization', 'string', 'Prior authorization number (UTN)'),
    f('priorAuthorizationExpiresOn', 'string', 'Prior authorization expires on'),
    f('deceased', 'boolean', 'Pronounced dead before loading (QL)'),
    f('nonCoveredMiles', 'number', 'Miles beyond the nearest appropriate facility (A0888)'),
    f('patientCount', 'integer', 'Patients transported on the trip'),
    f('abnOnFile', 'boolean', 'Advance Beneficiary Notice on file'),
    f('abnSignedOn', 'string', 'Advance Beneficiary Notice signed on'),
    f('denialExpected', 'boolean', 'A biller expects Medicare to deny the transport'),
    f('mspEmployerPlan', 'boolean', 'MSP: group health plan from current employment'),
    f('mspEsrd', 'boolean', 'MSP: end-stage renal disease coordination period'),
    f('mspDisability', 'boolean', 'MSP: disabled with a group health plan through employment'),
    f('mspEmployerSize', 'integer', 'MSP: employees at the employer'),
    f('mspAccident', 'string', 'MSP: accident or work injury'),
    f('facilityStay', 'string', 'Facility stay a biller confirmed (none, inpatient or snf)'),
    f('payers', { list: RECORDED_PAYER.type }, 'Payers, in billing order'),
    f('pickupFacility', FACILITY.type, 'Pickup facility in the directory'),
    f('destinationFacility', FACILITY.type, 'Destination facility in the directory'),
    f('responsibleParty', 'string', 'Who the claim is billed to (payer or facility)'),
    f('responsibilityRecorded', 'boolean', 'Who pays was decided and recorded'),
    f('documents', { list: 'string' }, 'Kinds of documents on file')
  ]
);

export const CLAIM_DOCUMENT = model(
  'billing.claim-document',
  'document',
  'Claim Document',
  'a document uploaded to a claim, such as a facesheet, certification, signature form, ABN or MSP form',
  [
    f('id', { id: 'document' }, 'Document ID'),
    f('kind', 'string', 'Kind (facesheet, pcs, signature, abn or msp)'),
    f('signedOn', 'string', 'Signed on (YYYY-MM-DD)'),
    f('fileName', 'string', 'File name')
  ]
);
