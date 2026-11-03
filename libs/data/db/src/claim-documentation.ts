import { type Documentation, readDocumentation } from '@ugula/billing';

export const DOCUMENTATION_COLUMNS = [
  'c.signature',
  'c.signature_note',
  'c.pcs_on_file',
  'c.pcs_signed_on',
  'c.transport_reason',
  'c.condition_codes',
  'c.prior_authorization',
  'c.weight_kg',
  'c.at_scene_at',
  'c.left_scene_at',
  'c.at_destination_at'
] as const;

export type DocumentationRow = {
  signature: string;
  signature_note: string | null;
  pcs_on_file: boolean | null;
  pcs_signed_on: string | null;
  transport_reason: string | null;
  condition_codes: string[];
  prior_authorization: string | null;
  weight_kg: string | null;
  at_scene_at: Date | null;
  left_scene_at: Date | null;
  at_destination_at: Date | null;
};

export const documentationOf = (row: DocumentationRow): Documentation =>
  readDocumentation({
    signature: row.signature,
    signatureNote: row.signature_note,
    pcsOnFile: row.pcs_on_file,
    pcsSignedOn: row.pcs_signed_on,
    transportReason: row.transport_reason,
    conditionCodes: row.condition_codes,
    priorAuthorization: row.prior_authorization,
    weightKg: row.weight_kg === null ? null : Number(row.weight_kg),
    atScene: row.at_scene_at?.toISOString() ?? null,
    leftScene: row.left_scene_at?.toISOString() ?? null,
    atDestination: row.at_destination_at?.toISOString() ?? null
  });

export const documentationValues = (d: Documentation) => ({
  signature: d.signature,
  signature_note: d.signatureNote,
  pcs_on_file: d.pcsOnFile,
  pcs_signed_on: d.pcsSignedOn,
  transport_reason: d.transportReason,
  condition_codes: d.conditionCodes,
  prior_authorization: d.priorAuthorization,
  weight_kg: d.weightKg,
  at_scene_at: d.atScene,
  left_scene_at: d.leftScene,
  at_destination_at: d.atDestination
});
