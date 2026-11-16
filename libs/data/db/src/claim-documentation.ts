import { type Documentation, readDocumentation } from '@ugula/billing';

export const DOCUMENTATION_COLUMNS = [
  'c.signature',
  'c.signature_note',
  'c.has_pcs',
  'c.pcs_signed_on',
  'c.transport_reason',
  'c.condition_codes',
  'c.prior_authorization',
  'c.weight_kg',
  'c.at_scene_at',
  'c.left_scene_at',
  'c.at_destination_at',
  'c.patient_count',
  'c.closest_facility_miles',
  'c.has_abn',
  'c.abn_signed_on',
  'c.is_denial_expected',
  'c.has_msp_employer_plan',
  'c.has_msp_esrd',
  'c.has_msp_disability',
  'c.msp_accident',
  'c.prior_authorization_expires_on',
  'c.pcs_type',
  'c.round_trips',
  'c.admitted_on',
  'c.facility_stay'
] as const;

type DocumentationRow = {
  signature: string;
  signature_note: string | null;
  has_pcs: boolean | null;
  pcs_signed_on: string | null;
  transport_reason: string | null;
  condition_codes: string[];
  prior_authorization: string | null;
  weight_kg: string | null;
  at_scene_at: Date | null;
  left_scene_at: Date | null;
  at_destination_at: Date | null;
  patient_count: number | null;
  closest_facility_miles: string | null;
  has_abn: boolean | null;
  abn_signed_on: string | null;
  is_denial_expected: boolean | null;
  has_msp_employer_plan: boolean | null;
  has_msp_esrd: boolean | null;
  has_msp_disability: boolean | null;
  msp_accident: string | null;
  prior_authorization_expires_on: string | null;
  pcs_type: string | null;
  round_trips: number | null;
  admitted_on: string | null;
  facility_stay: string | null;
};

const numberOrNull = (x: string | null) => (x === null ? null : Number(x));

export const documentationOf = (row: DocumentationRow): Documentation =>
  readDocumentation({
    signature: row.signature,
    signatureNote: row.signature_note,
    pcsOnFile: row.has_pcs,
    pcsSignedOn: row.pcs_signed_on,
    transportReason: row.transport_reason,
    conditionCodes: row.condition_codes,
    priorAuthorization: row.prior_authorization,
    weightKg: numberOrNull(row.weight_kg),
    atScene: row.at_scene_at?.toISOString() ?? null,
    leftScene: row.left_scene_at?.toISOString() ?? null,
    atDestination: row.at_destination_at?.toISOString() ?? null,
    patientCount: row.patient_count,
    closestFacilityMiles: numberOrNull(row.closest_facility_miles),
    abnOnFile: row.has_abn,
    abnSignedOn: row.abn_signed_on,
    denialExpected: row.is_denial_expected,
    mspEmployerPlan: row.has_msp_employer_plan,
    mspEsrd: row.has_msp_esrd,
    mspDisability: row.has_msp_disability,
    mspAccident: row.msp_accident,
    priorAuthorizationExpiresOn: row.prior_authorization_expires_on,
    pcsType: row.pcs_type,
    roundTrips: row.round_trips,
    admissionDate: row.admitted_on,
    facilityStay: row.facility_stay
  });

export const documentationValues = (d: Documentation) => ({
  signature: d.signature,
  signature_note: d.signatureNote,
  has_pcs: d.pcsOnFile,
  pcs_signed_on: d.pcsSignedOn,
  transport_reason: d.transportReason,
  condition_codes: d.conditionCodes,
  prior_authorization: d.priorAuthorization,
  weight_kg: d.weightKg,
  at_scene_at: d.atScene,
  left_scene_at: d.leftScene,
  at_destination_at: d.atDestination,
  patient_count: d.patientCount,
  closest_facility_miles: d.closestFacilityMiles,
  has_abn: d.abnOnFile,
  abn_signed_on: d.abnSignedOn,
  is_denial_expected: d.denialExpected,
  has_msp_employer_plan: d.mspEmployerPlan,
  has_msp_esrd: d.mspEsrd,
  has_msp_disability: d.mspDisability,
  msp_accident: d.mspAccident,
  prior_authorization_expires_on: d.priorAuthorizationExpiresOn,
  pcs_type: d.pcsType,
  round_trips: d.roundTrips,
  admitted_on: d.admissionDate,
  facility_stay: d.facilityStay
});
