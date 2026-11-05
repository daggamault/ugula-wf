import type { Model, ValueType } from '@ugula/graph';
import {
  CHECK_FACTS,
  CHECKED_PAYER,
  CLAIM_DOCUMENT,
  CLAIM_ISSUE,
  FACILITY
} from './check-models.ts';
import {
  CLAIM,
  CLINICAL_FACTS,
  DOCUMENTATION,
  ENCOUNTER_FACTS,
  FINDINGS,
  LINE,
  LOCATION_FACTS,
  SERVICE,
  TRIP_FACTS
} from './claim-models.ts';
import {
  ADJUSTMENT,
  CLAIM_LEDGER,
  DEADLINE,
  DENIAL_FACTS,
  PATIENT_BALANCE_FACTS,
  REFUND_FACTS,
  REMITTANCE_LINE,
  REMITTANCE_POSTING
} from './ledger-models.ts';
import { BLOB } from './model-kit.ts';
import { COVERAGE, DEMOGRAPHICS, LOCATION, PATIENT } from './party-models.ts';
import {
  PRIOR_PAYER,
  SUBMISSION,
  SUBMITTED_DETAILS,
  SUBMITTED_PATIENT,
  SUBMITTED_PAYER,
  X837_CLAIM,
  X837_LINE,
  X837_OTHER_PAYER,
  X837_PATIENT,
  X837_PAYER,
  X837_SUBSCRIBER
} from './submission-models.ts';

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
  facility: FACILITY.type,
  document: CLAIM_DOCUMENT.type,
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
  FACILITY,
  CHECK_FACTS,
  CLAIM_LEDGER,
  DENIAL_FACTS,
  REFUND_FACTS,
  PATIENT_BALANCE_FACTS,
  DEADLINE,
  ADJUSTMENT,
  REMITTANCE_LINE,
  REMITTANCE_POSTING,
  CLAIM_DOCUMENT,
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
