import type {
  ClaimStatus,
  Classification,
  DocumentKind,
  EligibilityStatus,
  FacilityStay,
  InboundKind,
  InsuredRelationship,
  MspAccident,
  PayerFileOutcome,
  PcsType,
  SignatureStatus,
  StayKind,
  TransportReason
} from '@ugula/billing';

export type CycleStatus =
  | 'running'
  | 'suspended'
  | 'completed'
  | 'faulted'
  | 'failed'
  | 'cancelled';

type TaskKind = 'task' | 'fault';

export type ClaimSummary = {
  id: string;
  number: string;
  patient_number: string | null;
  pcr_number: string | null;
  encounter_number: string | null;
  level: string | null;
  total_cents: number;
  balance_cents: number;
  service_date: string | null;
  payers: string[];
  status: ClaimStatus;
  created_at: string;
  first_name: string | null;
  last_name: string | null;
  task_id: string | null;
  task_title: string | null;
  task_queue: string | null;
  task_kind: TaskKind | null;
  task_assignee_email: string | null;
  open_tasks: number;
};

export type ClaimTask = {
  id: string;
  title: string;
  subject: string | null;
  queue: string;
  kind: TaskKind;
  assignee_id: string | null;
  assignee_email: string | null;
  due_at: string | null;
  created_at: string;
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
  eligibility: EligibilityStatus | null;
  eligibility_note: string | null;
  eligibility_checked_at: string | null;
  stay_kind: StayKind | null;
  stay_admitted_on: string | null;
  stay_discharged_on: string | null;
};

export type ClaimDocument = {
  id: string;
  kind: DocumentKind;
  file_name: string;
  signed_on: string | null;
  created_at: string;
  uploaded_by_email: string | null;
};

export type ClaimPayerFile = {
  id: string;
  kind: InboundKind;
  file_name: string;
  created_at: string;
  items: { outcome: PayerFileOutcome; message: string }[];
};

export type ClaimDetail = ClaimSummary & {
  classification: Classification | null;
  emergency: boolean | null;
  import_report_id: string | null;
  import_id: string | null;
  import_file_name: string | null;
  loaded_miles: string | null;
  birth_date: string | null;
  patient_id: string | null;
  cycle_run_id: string | null;
  cycle_status: CycleStatus | null;
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
  pcs_on_file: boolean | null;
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
  abn_on_file: boolean | null;
  abn_signed_on: string | null;
  denial_expected: boolean | null;
  msp_employer_plan: boolean | null;
  msp_esrd: boolean | null;
  msp_disability: boolean | null;
  msp_accident: MspAccident | null;
  prior_authorization_expires_on: string | null;
  pcs_type: PcsType | null;
  round_trips: number | null;
  admission_date: string | null;
  facility_stay: FacilityStay | null;
  deceased: boolean;
  non_covered_miles: string | null;
  coverages: ClaimCoverage[];
  lines: ClaimLine[];
  diagnoses: string[];
  tasks: ClaimTask[];
  facility_id: string | null;
  facility_name: string | null;
};
