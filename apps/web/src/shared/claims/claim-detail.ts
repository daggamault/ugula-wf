import type {
  ClaimStatus,
  Classification,
  CoverageStatus,
  InsuredRelationship,
  Sex,
  TransportReason
} from '@ugula/billing';

export type ClaimSummary = {
  id: string;
  number: string;
  patient_number: string | null;
  pcr_number: string | null;
  encounter_number: string | null;
  level: string | null;
  total_cents: number;
  service_date: string | null;
  payers: string[];
  status: ClaimStatus;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
};

export type ClaimLine = {
  position: number;
  code: string;
  modifiers: string[];
  units: number;
  unit_cents: number;
  total_cents: number;
};

export type ClaimCoverage = {
  id: string;
  position: number;
  payer: string;
  relationship: InsuredRelationship;
  insured_first_name: string | null;
  insured_last_name: string | null;
  payer_id: string | null;
  member_id: string | null;
  group_id: string | null;
  status: CoverageStatus;
  payer_claim_number: string | null;
  status_note: string | null;
  paid_cents: number | null;
  patient_cents: number | null;
};

type EncounterAddress = {
  line: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

export type EncounterLocation = {
  name: string | null;
  address: EncounterAddress;
};

type EncounterTimes = Record<
  | 'call'
  | 'unitNotified'
  | 'enRoute'
  | 'atScene'
  | 'atPatient'
  | 'leftScene'
  | 'atDestination'
  | 'transferOfCare'
  | 'backInService',
  string | null
>;

type ClaimEncounter = {
  pcrNumber: string | null;
  times: EncounterTimes;
  pickup: EncounterLocation;
  destination: EncounterLocation;
  narrative: string | null;
};

export type ClaimDetail = ClaimSummary & {
  revision: number;
  reviewed_at: string | null;
  review_note: string | null;
  status_note: string | null;
  reviewed_by: string | null;
  import_id: string | null;
  import_file_name: string | null;
  sent_file_name: string | null;
  sent_control_number: number | null;
  sent_at: string | null;
  encounter_revision: number;
  encounter: ClaimEncounter;
  classification: Classification;
  is_emergency: boolean;
  loaded_miles: string | null;
  origin_code: string | null;
  destination_code: string | null;
  transport_reason: TransportReason | null;
  condition_codes: string[];
  weight_pounds: number | null;
  reasons: string[];
  patient_id: string;
  birth_date: string | null;
  sex: Sex | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  pickup_name: string | null;
  pickup_address_line: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_postal_code: string | null;
  destination_name: string | null;
  destination_address_line: string | null;
  destination_city: string | null;
  destination_state: string | null;
  destination_postal_code: string | null;
  prior_authorization: string | null;
  is_signature_on_file: boolean;
  note: string | null;
  coverages: ClaimCoverage[];
  lines: ClaimLine[];
  diagnoses: string[];
};
