export const DOCUMENT_KINDS = {
  facesheet: 'Facesheet',
  pcs: 'Physician certification statement',
  signature: 'Signature form',
  abn: 'Advance Beneficiary Notice',
  msp: 'Medicare Secondary Payer questionnaire'
} as const;

export type DocumentKind = keyof typeof DOCUMENT_KINDS;

export const isDocumentKind = (x: unknown): x is DocumentKind =>
  typeof x === 'string' && Object.hasOwn(DOCUMENT_KINDS, x);

export const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff'
] as const;

export const isDocumentContentType = (x: unknown) =>
  DOCUMENT_CONTENT_TYPES.includes(x as (typeof DOCUMENT_CONTENT_TYPES)[number]);

export type ClaimDocument = {
  id: string;
  kind: DocumentKind;
  signedOn: string | null;
  fileName: string;
};
