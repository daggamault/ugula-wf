import { type Model, type ModelField, modelType, type ValueType } from '@ugula/graph';

const CATEGORY = 'Billing';

const X12 = 'X12 837P';

const f = (name: string, type: ValueType, label: string): ModelField => ({ name, type, label });

const model = (
  key: string,
  name: string,
  title: string,
  description: string,
  fields: ModelField[],
  category = CATEGORY
): Model & { type: ValueType } => ({
  key,
  name,
  title,
  category,
  description,
  fields,
  type: modelType({ fields })
});

const ADDRESS = [
  f('addressLine', 'string', 'Street address'),
  f('city', 'string', 'City'),
  f('state', 'string', 'State'),
  f('postalCode', 'string', 'ZIP code')
];

export const BLOB = { object: { bucket: 'string', key: 'string' } } as const satisfies ValueType;

const ADJUSTMENT_TYPE = {
  object: { group: 'string', reason: 'string', cents: 'integer' }
} as const satisfies ValueType;

export const DEMOGRAPHICS = model(
  'billing.demographics',
  'demographics',
  'Demographics',
  'the name, birth date, sex and address a patient is matched and created by',
  [
    f('firstName', 'string', 'First name'),
    f('lastName', 'string', 'Last name'),
    f('birthDate', 'string', 'Birth date (YYYY-MM-DD)'),
    f('gender', 'string', 'Sex (F, M or U)'),
    ...ADDRESS
  ]
);

export const PATIENT = model('billing.patient', 'patient', 'Patient', 'a billing patient', [
  f('id', 'string', 'Patient ID'),
  ...DEMOGRAPHICS.fields
]);

export const LOCATION = model(
  'billing.location',
  'location',
  'Location',
  'a named place such as a pickup or destination',
  [f('name', 'string', 'Name'), ...ADDRESS]
);

export const COVERAGE = model(
  'billing.coverage',
  'coverage',
  'Coverage',
  'one payer that covers a claim, and who holds the policy',
  [
    f('payer', 'string', 'Payer name as reported'),
    f('payerId', 'string', 'Directory payer ID'),
    f('directoryName', 'string', 'Directory payer name'),
    f('payerCode', 'string', 'Payer code'),
    f('priority', 'string', 'Billing priority'),
    f('memberId', 'string', 'Member ID'),
    f('groupId', 'string', 'Group ID'),
    f('relationship', 'string', 'Patient relationship to the insured (X12 or NEMSIS code)'),
    f('insuredFirstName', 'string', 'Insured first name'),
    f('insuredLastName', 'string', 'Insured last name')
  ]
);

export const SERVICE = model(
  'billing.service',
  'service',
  'Service',
  'the level of service, emergency status and loaded miles of a trip, with the reasons',
  [
    f('level', 'string', 'Level of service (BLS, ALS1, ALS2, SCT)'),
    f('emergency', 'boolean', 'Emergency response'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('basis', { list: 'string' }, 'Reasons')
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

const CHECKED_PAYER = model(
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
    f('filingDaysLeft', 'integer', 'Days left to file')
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
    f('payers', { list: CHECKED_PAYER.type }, 'Payers, in billing order')
  ]
);

export const CLAIM_LEDGER = model(
  'billing.claim-ledger',
  'ledger',
  'Claim Ledger',
  'where a claim stands from its history: balance, the payer being billed, approvals, responses and statements',
  [
    f('balanceCents', 'integer', 'Balance (cents)'),
    f('coverageId', 'string', 'Payer being billed (coverage ID)'),
    f('payer', 'string', 'Payer being billed'),
    f('payerKind', 'string', 'Claim filing indicator of the payer being billed, or patient'),
    f('coverageCount', 'integer', 'Payers on the claim'),
    f('contacted', 'boolean', 'The payer being billed has the claim'),
    f('sinceContactMs', 'integer', 'Milliseconds since the payer was last contacted'),
    f('approved', 'boolean', 'The claim is approved for the payer being billed'),
    f('unreconciledCoverageId', 'string', 'Payer whose response waits to be reconciled'),
    f('unreconciledPayer', 'string', 'Name of the payer whose response waits to be reconciled'),
    f(
      'denialRoute',
      'string',
      'How the denial waiting to be worked was routed: denial, appeal or fix'
    ),
    f('appeals', 'integer', 'Appeals already sent on that denial'),
    f('billFacility', 'boolean', 'A facility is responsible for the trip'),
    f('patientApproved', 'boolean', 'The claim is approved for billing the patient'),
    f('statements', 'integer', 'Patient statements sent'),
    f('sinceStatementMs', 'integer', 'Milliseconds since the last statement'),
    f('rejection', 'string', 'Why the last submission was rejected')
  ]
);

export const DENIAL_FACTS = model(
  'billing.denial-facts',
  'denial',
  'Denial Facts',
  'a payer denial waiting to be worked: the payer, how it was routed, its reason codes and the payer settings that decide how to correct or appeal it',
  [
    f('coverageId', 'string', 'Payer that denied (coverage ID)'),
    f('payer', 'string', 'Payer that denied'),
    f('payerKind', 'string', 'Claim filing indicator of the payer'),
    f('route', 'string', 'How Remittance Routing routed it: denial, appeal or fix'),
    f('note', 'string', 'What the routing said'),
    f('codes', { list: 'string' }, 'Group and reason codes of the denial (CO-50)'),
    f('paidCents', 'integer', 'Paid by the payer (cents)'),
    f('balanceCents', 'integer', 'Balance (cents)'),
    f('deniedOn', 'string', 'Date of the remittance that denied it (YYYY-MM-DD)'),
    f('appeals', 'integer', 'Appeals already sent on this denial'),
    f('payerClaimNumber', 'string', 'Payer claim control number'),
    f(
      'correctionMethod',
      'string',
      'How the payer takes corrections: replacement or reopening, if set'
    ),
    f('appealDays', 'integer', 'Days the payer allows to appeal, if set')
  ]
);

export const REFUND_FACTS = model(
  'billing.refund-facts',
  'refund',
  'Refund Facts',
  'a credit balance: how much more was paid than charged, by whom and when it was found',
  [
    f('overpaidCents', 'integer', 'Paid beyond the charges (cents)'),
    f('coverageId', 'string', 'Payer that overpaid (coverage ID), or none for the patient'),
    f('payer', 'string', 'Payer that overpaid'),
    f('payerKind', 'string', 'Claim filing indicator of that payer, or patient'),
    f('paidCents', 'integer', 'What that payer or the patient paid in all (cents)'),
    f('identifiedOn', 'string', 'Date the credit balance appeared (YYYY-MM-DD)')
  ]
);

export const PATIENT_BALANCE_FACTS = model(
  'billing.patient-balance-facts',
  'patientBalance',
  'Patient Balance Facts',
  'what is left for the patient once every payer is done, with what decides whether state law protects it',
  [
    f('balanceCents', 'integer', 'Balance (cents)'),
    f(
      'costShareCents',
      'integer',
      'Patient responsibility the payers stated (PR adjustments, cents)'
    ),
    f('state', 'string', 'State of the pickup'),
    f('serviceDate', 'string', 'Date of service (YYYY-MM-DD)'),
    f(
      'planType',
      'string',
      'Plan type of the last payer: fully_insured, self_funded or government'
    ),
    f('payerKind', 'string', 'Claim filing indicator of the last payer, or patient'),
    f(
      'protectedCents',
      'integer',
      'Already taken off the balance by balance-billing protection (cents)'
    )
  ]
);

export const DEADLINE = model(
  'billing.deadline',
  'deadline',
  'Deadline',
  'a claim deadline coming up: timely filing, an appeal, a records request, a refund or a physician certification',
  [
    f('kind', 'string', 'timelyFiling, appeal, records, refund or pcs'),
    f('claimId', 'string', 'Claim'),
    f('coverageId', 'string', 'Payer (coverage ID)'),
    f('reference', 'string', 'Claim number and patient'),
    f('dueOn', 'string', 'Due date (YYYY-MM-DD)'),
    f('daysLeft', 'integer', 'Days left (negative once passed)'),
    f('taskId', 'string', 'The open task the deadline belongs to, if any'),
    f('priority', 'integer', 'Priority of that task'),
    f('reminded', 'boolean', 'A reminder for this deadline is already open')
  ]
);

const ADJUSTMENT = model(
  'billing.adjustment',
  'adjustment',
  'Adjustment',
  'one 835 adjustment: its group code, reason code (CARC) and amount',
  [
    f('group', 'string', 'Group code (CO, PR, OA, PI, CR)'),
    f('reason', 'string', 'Reason code (CARC)'),
    f('cents', 'integer', 'Amount (cents)')
  ]
);

export const REMITTANCE_LINE = model(
  'billing.remittance-line',
  'line',
  'Remittance Line',
  'one claim payment (CLP) of an 835, with the claim and payer it matched',
  [
    f('position', 'integer', 'Position in the file'),
    f('reference', 'string', 'Claim number the payer sent (CLP01)'),
    f('claimId', 'string', 'Matched claim'),
    f('coverageId', 'string', 'Matched payer on the claim'),
    f('payerName', 'string', 'Payer name'),
    f('denied', 'boolean', 'The payer denied the claim'),
    f('reversal', 'boolean', 'The payer reversed an earlier payment'),
    f('takeback', 'boolean', 'The payment or an adjustment takes money back'),
    f('paidCents', 'integer', 'Paid (cents)'),
    f('adjustments', { list: ADJUSTMENT.type }, 'Adjustments, merged by group and reason')
  ]
);

export const REMITTANCE_POSTING = model(
  'billing.remittance-posting',
  'posting',
  'Remittance Posting',
  'how one 835 claim payment is posted: its route, what lowers the balance and why',
  [
    f('position', 'integer', 'Position in the file'),
    f('route', 'string', 'Route (reconcile, review or unmatched)'),
    f('message', 'string', 'What a biller sees about the line'),
    f('adjustedCents', 'integer', 'Adjustments that lower the balance (cents)'),
    f('reasons', { list: 'string' }, 'Why')
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
    f('atDestination', 'string', 'Arrived at the destination')
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

const SUBMITTED_PATIENT = model(
  'billing.submitted-patient',
  'patient',
  'Submitted Patient',
  'the patient of a claim being submitted',
  [
    f('firstName', 'string', 'First name'),
    f('lastName', 'string', 'Last name'),
    f('birthDate', 'string', 'Birth date'),
    f('sex', 'string', 'Sex (F, M or U)'),
    ...ADDRESS
  ]
);

const PAYER_FIELDS = [
  f('name', 'string', 'Payer name'),
  f('payerId', 'string', 'Clearinghouse payer ID'),
  f('claimFiling', 'string', 'Claim filing indicator'),
  f('memberId', 'string', 'Member ID'),
  f('groupId', 'string', 'Group ID'),
  f('relationship', 'string', 'Patient relationship to the insured (X12)'),
  f('insuredFirstName', 'string', 'Insured first name'),
  f('insuredLastName', 'string', 'Insured last name')
];

const SUBMITTED_PAYER = model(
  'billing.submitted-payer',
  'payer',
  'Submitted Payer',
  'the payer a claim is being submitted to, with the policy holder',
  PAYER_FIELDS
);

const PRIOR_PAYER = model(
  'billing.prior-payer',
  'payer',
  'Prior Payer',
  'a payer that already adjudicated a claim, with what it paid and adjusted',
  [
    ...PAYER_FIELDS,
    f('paidCents', 'integer', 'Paid (cents)'),
    f('adjustedCents', 'integer', 'Adjusted (cents)'),
    f('paidOn', 'string', 'Adjudication date (YYYY-MM-DD)'),
    f('adjustments', { list: ADJUSTMENT_TYPE }, 'Adjustment reason codes')
  ]
);

const SUBMITTED_DETAILS = model(
  'billing.submitted-details',
  'details',
  'Submitted Trip',
  'the trip details of a claim being submitted',
  [
    f('serviceDate', 'string', 'Date of service'),
    f('pickup', LOCATION.type, 'Pickup'),
    f('destination', LOCATION.type, 'Destination'),
    f('diagnoses', { list: 'string' }, 'ICD-10 diagnoses'),
    f('originDestination', 'string', 'Origin/destination modifier'),
    f('documentation', DOCUMENTATION.type, 'Documentation')
  ]
);

const SUBMISSION = model(
  'billing.submission',
  'claim',
  'Claim to Submit',
  'a saved claim on its way to a payer',
  [
    f('claimId', 'string', 'Claim ID'),
    f('payerClaimNumber', 'string', 'Payer claim number of the claim it replaces'),
    f('payer', SUBMITTED_PAYER.type, 'Payer'),
    f('priorPayers', { list: PRIOR_PAYER.type }, 'Payers that already adjudicated it, in order'),
    f('patient', SUBMITTED_PATIENT.type, 'Patient'),
    f('details', SUBMITTED_DETAILS.type, 'Trip'),
    f('emergency', 'boolean', 'Emergency response'),
    f('loadedMiles', 'number', 'Loaded miles'),
    f('lines', { list: LINE.type }, 'Priced lines')
  ]
);

const X837_SUBSCRIBER = model(
  'x837.subscriber',
  'subscriber',
  'Subscriber',
  'the 837P subscriber loop (2010BA); a self subscriber is named after the patient when blank',
  [
    f('relationship', 'string', 'Patient relationship (SBR02, PAT01)'),
    f('lastName', 'string', 'Last name (NM103)'),
    f('firstName', 'string', 'First name (NM104)'),
    f('memberId', 'string', 'Member ID (NM109)'),
    f('groupId', 'string', 'Group number (SBR03)')
  ],
  X12
);

const X837_PATIENT = model(
  'x837.patient',
  'patient',
  'Patient',
  'the person transported: written in the subscriber loop when self, else the patient loop (2010CA)',
  [
    f('lastName', 'string', 'Last name (NM103)'),
    f('firstName', 'string', 'First name (NM104)'),
    ...ADDRESS,
    f('birthDate', 'string', 'Birth date (DMG02)'),
    f('sex', 'string', 'Sex (DMG03)')
  ],
  X12
);

const X837_PAYER = model(
  'x837.payer',
  'payer',
  'Payer',
  'the 837P payer loop (2010BB)',
  [
    f('name', 'string', 'Payer name (NM103)'),
    f('payerId', 'string', 'Payer ID (NM109)'),
    f('claimFiling', 'string', 'Claim filing indicator (SBR09)')
  ],
  X12
);

const X837_OTHER_PAYER = model(
  'x837.other-payer',
  'otherPayer',
  'Other Payer',
  'a payer that already adjudicated the claim (2320, 2330A, 2330B), in billing order',
  [
    f('name', 'string', 'Payer name (2330B NM103)'),
    f('payerId', 'string', 'Payer ID (2330B NM109)'),
    f('claimFiling', 'string', 'Claim filing indicator (SBR09)'),
    f('memberId', 'string', 'Member ID (2330A NM109)'),
    f('groupId', 'string', 'Group number (SBR03)'),
    f('relationship', 'string', 'Patient relationship (SBR02)'),
    f('lastName', 'string', 'Insured last name (2330A NM103)'),
    f('firstName', 'string', 'Insured first name (2330A NM104)'),
    f('paidCents', 'integer', 'Paid in cents (AMT02)'),
    f('adjustedCents', 'integer', 'Adjusted in cents, without reason codes (CAS)'),
    f('paidOn', 'string', 'Adjudication date (DTP03)'),
    f('adjustments', { list: ADJUSTMENT_TYPE }, 'Adjustment reason codes (CAS)')
  ],
  X12
);

const X837_LINE = model(
  'x837.line',
  'line',
  'Service Line',
  'one 837P service line (2400)',
  [
    f('code', 'string', 'HCPCS code (SV101-2)'),
    f('modifiers', { list: 'string' }, 'Modifiers (SV101-3 to 6)'),
    f('chargeCents', 'integer', 'Charge in cents (SV102)'),
    f('units', 'number', 'Units (SV104)'),
    f('serviceDate', 'string', 'Date of service (DTP03)')
  ],
  X12
);

export const X837_CLAIM = model(
  'x837.claim',
  'x837',
  '837P Claim',
  'one 837P claim (2300) with its subscriber, patient, payers and service lines',
  [
    f('claimId', 'string', 'Patient control number (CLM01)'),
    f('placeOfService', 'string', 'Place of service (CLM05-1)'),
    f('frequency', 'string', 'Claim frequency (CLM05-3)'),
    f('payerClaimNumber', 'string', 'Payer claim control number (REF F8)'),
    f('priorAuthorization', 'string', 'Prior authorization number (REF G1)'),
    f('subscriber', X837_SUBSCRIBER.type, 'Subscriber'),
    f('patient', X837_PATIENT.type, 'Patient'),
    f('payer', X837_PAYER.type, 'Payer'),
    f('otherPayers', { list: X837_OTHER_PAYER.type }, 'Other payers (2320)'),
    f('weightPounds', 'integer', 'Patient weight in pounds (CR102)'),
    f('transportReason', 'string', 'Transport reason (CR104), with loaded miles'),
    f('loadedMiles', 'number', 'Loaded miles (CR106), none without transport'),
    f('conditionCodes', { list: 'string' }, 'Ambulance conditions (CRC03 to 07)'),
    f('diagnoses', { list: 'string' }, 'Diagnoses (HI)'),
    f('pickup', LOCATION.type, 'Pickup (2310E)'),
    f('dropoff', LOCATION.type, 'Drop-off (2310F), with transport'),
    f('lines', { list: X837_LINE.type }, 'Service lines')
  ],
  X12
);

export const billingTypes = {
  blob: BLOB,
  demographics: DEMOGRAPHICS.type,
  patient: PATIENT.type,
  location: LOCATION.type,
  coverages: { list: COVERAGE.type },
  service: SERVICE.type,
  findings: FINDINGS.type,
  issues: { list: CLAIM_ISSUE.type },
  checkFacts: CHECK_FACTS.type,
  ledger: CLAIM_LEDGER.type,
  denial: DENIAL_FACTS.type,
  refund: REFUND_FACTS.type,
  patientBalance: PATIENT_BALANCE_FACTS.type,
  deadlines: { list: DEADLINE.type },
  adjustments: { list: ADJUSTMENT.type },
  remittanceLines: { list: REMITTANCE_LINE.type },
  postings: { list: REMITTANCE_POSTING.type },
  trip: TRIP_FACTS.type,
  locations: LOCATION_FACTS.type,
  clinical: CLINICAL_FACTS.type,
  facts: ENCOUNTER_FACTS.type,
  lines: { list: LINE.type },
  documentation: DOCUMENTATION.type,
  claim: CLAIM.type,
  submission: SUBMISSION.type,
  x837: X837_CLAIM.type
} satisfies Record<string, ValueType>;

export const billingModels: Model[] = [
  DEMOGRAPHICS,
  PATIENT,
  LOCATION,
  COVERAGE,
  SERVICE,
  FINDINGS,
  CLAIM_ISSUE,
  CHECKED_PAYER,
  CHECK_FACTS,
  CLAIM_LEDGER,
  DENIAL_FACTS,
  REFUND_FACTS,
  PATIENT_BALANCE_FACTS,
  DEADLINE,
  ADJUSTMENT,
  REMITTANCE_LINE,
  REMITTANCE_POSTING,
  LINE,
  DOCUMENTATION,
  TRIP_FACTS,
  LOCATION_FACTS,
  CLINICAL_FACTS,
  ENCOUNTER_FACTS,
  CLAIM,
  SUBMITTED_PATIENT,
  SUBMITTED_PAYER,
  PRIOR_PAYER,
  SUBMITTED_DETAILS,
  SUBMISSION,
  X837_SUBSCRIBER,
  X837_PATIENT,
  X837_PAYER,
  X837_OTHER_PAYER,
  X837_LINE,
  X837_CLAIM
].map(({ type: _, ...m }) => m);
