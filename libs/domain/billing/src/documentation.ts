import { recordOf, textOrNull } from './values.ts';

export const SIGNATURE_STATUSES = ['signed', 'exception', 'refused', 'missing'] as const;

export type SignatureStatus = (typeof SIGNATURE_STATUSES)[number];

export const SIGNATURE_LABELS: Record<SignatureStatus, string> = {
  signed: 'Signed by the patient or their representative',
  exception: 'Not signed, with a documented reason the patient could not sign',
  refused: 'The patient refused to sign',
  missing: 'No billing signature'
};

export const isSignatureStatus = (x: unknown): x is SignatureStatus =>
  SIGNATURE_STATUSES.includes(x as SignatureStatus);

export const TRANSPORT_REASONS = {
  A: 'Nearest facility for care of symptoms or complaints',
  B: 'For the benefit of a preferred physician',
  C: 'For the nearness of family members',
  D: 'For a specialist or equipment',
  E: 'Transfer to a rehabilitation facility'
} as const;

export type TransportReason = keyof typeof TRANSPORT_REASONS;

export const isTransportReason = (x: unknown): x is TransportReason =>
  typeof x === 'string' && Object.hasOwn(TRANSPORT_REASONS, x);

export const AMBULANCE_CONDITIONS = {
  '01': 'Patient was admitted to a hospital',
  '04': 'Patient was moved by stretcher',
  '05': 'Patient was unconscious or in shock',
  '06': 'Patient was transported in an emergency situation',
  '07': 'Patient had to be physically restrained',
  '08': 'Patient had visible hemorrhaging',
  '09': 'Ambulance service was medically necessary',
  '12': 'Patient is confined to a bed or chair'
} as const;

const isAmbulanceCondition = (x: unknown): x is string =>
  typeof x === 'string' && Object.hasOwn(AMBULANCE_CONDITIONS, x);

export const CONDITION_LIMIT = 5;

export type Documentation = {
  signature: SignatureStatus;
  signatureNote: string | null;
  pcsOnFile: boolean | null;
  pcsSignedOn: string | null;
  transportReason: TransportReason | null;
  conditionCodes: string[];
  priorAuthorization: string | null;
  weightKg: number | null;
  atScene: string | null;
  leftScene: string | null;
  atDestination: string | null;
};

const BILLING_RELEASE = '4513005';

const REPRESENTATIVE = '4512017';

const SIGNED = new Set(['4515027', '4515031', '4515033']);

const REFUSED = new Set(['4515019', '4515029']);

const SIGNED_BY_REPRESENTATIVE = '4515033';

const INCAPABLE: Readonly<Record<string, string>> = {
  '4515003': 'the patient died',
  '4515005': 'the patient was in distress',
  '4515013': "the patient's mental status was impaired",
  '4515015': 'the patient is a minor',
  '4515017': "the patient's hands or arms were impaired",
  '4515023': 'the patient was unconscious',
  '4515025': 'the patient is visually impaired',
  '4515035': 'the patient cannot read',
  '4515037': 'the patient was restrained',
  '4515039': 'the patient was combative or uncooperative'
};

const NOT_AN_EXCEPTION: Readonly<Record<string, string>> = {
  '4515001': 'the crew was called out to another call',
  '4515007': 'of an equipment failure',
  '4515009': 'the patient was in law enforcement custody',
  '4515011': 'of a language barrier',
  '4515021': 'care was transferred before a signature could be obtained'
};

type Signed = { signature: SignatureStatus; signatureNote: string | null };

const RANK: Record<SignatureStatus, number> = { signed: 0, exception: 1, refused: 2, missing: 3 };

const signedBy = (group: Record<string, unknown>): Signed => {
  const status = textOrNull(group.status) ?? '';
  if (SIGNED.has(status)) {
    const representative =
      status === SIGNED_BY_REPRESENTATIVE || textOrNull(group.signer) === REPRESENTATIVE;
    return {
      signature: 'signed',
      signatureNote: representative ? 'Signed by a patient representative' : null
    };
  }
  if (REFUSED.has(status)) {
    return { signature: 'refused', signatureNote: 'The patient refused to sign for billing' };
  }
  const incapable = INCAPABLE[status];
  if (incapable) {
    return { signature: 'exception', signatureNote: `Not signed because ${incapable}` };
  }
  const other = NOT_AN_EXCEPTION[status];
  return {
    signature: 'missing',
    signatureNote: other
      ? `Not signed because ${other}, which is not a reason the patient could not sign`
      : 'The billing signature has no status'
  };
};

export const signatureOf = (signatures: unknown): Signed => {
  const releases = (Array.isArray(signatures) ? signatures : [])
    .map(recordOf)
    .filter((g) => Array.isArray(g.reasons) && g.reasons.includes(BILLING_RELEASE))
    .map(signedBy)
    .sort((a, b) => RANK[a.signature] - RANK[b.signature]);
  return (
    releases[0] ?? {
      signature: 'missing',
      signatureNote: 'The report has no signature for the release for billing'
    }
  );
};

const PCS_YES = '9922005';

const PCS_NO = '9922001';

export const pcsOnFileOf = (code: unknown): boolean | null =>
  code === PCS_YES || code === true ? true : code === PCS_NO || code === false ? false : null;

const DATE = /^\d{4}-\d{2}-\d{2}/;

const dateOf = (x: unknown) => {
  const value = textOrNull(x);
  return value && DATE.test(value) ? value.slice(0, 10) : null;
};

const instantOf = (x: unknown) => {
  const value = textOrNull(x);
  return value && !Number.isNaN(Date.parse(value)) ? value : null;
};

const weightOf = (x: unknown) =>
  typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1000 ? x : null;

export const readDocumentation = (x: unknown): Documentation => {
  const r = recordOf(x);
  const reason = textOrNull(r.transportReason)?.toUpperCase();
  return {
    signature: isSignatureStatus(r.signature) ? r.signature : 'missing',
    signatureNote: textOrNull(r.signatureNote),
    pcsOnFile: pcsOnFileOf(r.pcsOnFile),
    pcsSignedOn: dateOf(r.pcsSignedOn),
    transportReason: isTransportReason(reason) ? reason : null,
    conditionCodes: [
      ...new Set(
        (Array.isArray(r.conditionCodes) ? r.conditionCodes : []).filter(isAmbulanceCondition)
      )
    ].slice(0, CONDITION_LIMIT),
    priorAuthorization: textOrNull(r.priorAuthorization),
    weightKg: weightOf(r.weightKg),
    atScene: instantOf(r.atScene),
    leftScene: instantOf(r.leftScene),
    atDestination: instantOf(r.atDestination)
  };
};

const POUNDS_PER_KG = 2.204_62;

export const poundsOf = (kg: number | null) =>
  kg === null ? null : Math.round(kg * POUNDS_PER_KG);

const DAY_MS = 86_400_000;

export const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(to.slice(0, 10)) - Date.parse(from.slice(0, 10))) / DAY_MS);
