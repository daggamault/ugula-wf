import type {
  ClaimStatus,
  Classification,
  FacilityStay,
  InsuredRelationship,
  MspAccident,
  PcsType,
  SignatureStatus,
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
  payer_code: string | null;
  member_id: string | null;
  group_id: string | null;
};

export type ClaimDetail = ClaimSummary & {
  classification: Classification | null;
  is_emergency: boolean | null;
  import_report_id: string | null;
  import_id: string | null;
  import_file_name: string | null;
  loaded_miles: string | null;
  birth_date: string | null;
  patient_id: string | null;
  origin_code: string | null;
  destination_code: string | null;
  pickup_address_line: string | null;
  pickup_city: string | null;
  pickup_state: string | null;
  pickup_postal_code: string | null;
  destination_name: string | null;
  destination_address_line: string | null;
  destination_city: string | null;
  destination_state: string | null;
  destination_postal_code: string | null;
  gender: string | null;
  address_line: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  signature: SignatureStatus;
  signature_note: string | null;
  has_pcs: boolean | null;
  pcs_signed_on: string | null;
  transport_reason: TransportReason | null;
  condition_codes: string[];
  prior_authorization: string | null;
  weight_kg: string | null;
  at_scene_at: string | null;
  left_scene_at: string | null;
  at_destination_at: string | null;
  patient_count: number | null;
  closest_facility_miles: string | null;
  has_abn: boolean | null;
  abn_signed_on: string | null;
  is_denial_expected: boolean | null;
  has_msp_employer_plan: boolean | null;
  has_msp_esrd: boolean | null;
  has_msp_disability: boolean | null;
  msp_employer_size: number | null;
  msp_accident: MspAccident | null;
  prior_authorization_expires_on: string | null;
  pcs_type: PcsType | null;
  round_trips: number | null;
  admitted_on: string | null;
  facility_stay: FacilityStay | null;
  is_deceased: boolean;
  non_covered_miles: string | null;
  coverages: ClaimCoverage[];
  lines: ClaimLine[];
  diagnoses: string[];
  facility_id: string | null;
  facility_name: string | null;
};
