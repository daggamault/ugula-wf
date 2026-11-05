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

const DOCUMENT_CONTENT_TYPES = [
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/tiff'
] as const;

type DocumentContentType = (typeof DOCUMENT_CONTENT_TYPES)[number];

const SIGNATURES: readonly [DocumentContentType, readonly number[]][] = [
  ['application/pdf', [0x25, 0x50, 0x44, 0x46, 0x2d]],
  ['image/png', [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  ['image/jpeg', [0xff, 0xd8, 0xff]],
  ['image/tiff', [0x49, 0x49, 0x2a, 0x00]],
  ['image/tiff', [0x4d, 0x4d, 0x00, 0x2a]]
];

export const documentContentTypeOf = (bytes: Uint8Array): DocumentContentType | null =>
  SIGNATURES.find(([, magic]) => magic.every((b, i) => bytes[i] === b))?.[0] ?? null;

export type ClaimDocument = {
  id: string;
  kind: DocumentKind;
  signedOn: string | null;
  fileName: string;
};
