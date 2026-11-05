import {
  type FacilityStay,
  isSignatureStatus,
  isTransportReason,
  type MspAccident,
  type PcsType
} from '@ugula/billing';
import type { BillingDataInput, ClaimDetail, DocumentationInput, LocationInput } from './client.ts';

export type Draft = {
  patient: Record<'addressLine' | 'city' | 'state' | 'postalCode', string>;
  coverages: { id: string; payer: string; memberId: string; groupId: string }[];
  serviceDate: string;
  pickup: Record<keyof LocationInput, string>;
  destination: Record<keyof LocationInput, string>;
  diagnoses: string;
  originCode: string;
  destinationCode: string;
  signature: string;
  transportReason: string;
  pcsOnFile: string;
  pcsSignedOn: string;
  pcsType: string;
  patientCount: string;
  abnOnFile: string;
  abnSignedOn: string;
  denialExpected: string;
  mspEmployerPlan: string;
  mspEsrd: string;
  mspDisability: string;
  mspAccident: string;
  priorAuthorization: string;
  priorAuthorizationExpiresOn: string;
  roundTrips: string;
  admissionDate: string;
  facilityStay: string;
};

export type TextKey = { [K in keyof Draft]: Draft[K] extends string ? K : never }[keyof Draft];

export type Flag =
  | 'pcsOnFile'
  | 'abnOnFile'
  | 'denialExpected'
  | 'mspEmployerPlan'
  | 'mspEsrd'
  | 'mspDisability';

const answerOf = (x: boolean | null) => (x === null ? '' : x ? 'yes' : 'no');

const flagOf = (x: string) => (x === 'yes' ? true : x === 'no' ? false : null);

const countOf = (x: string) => {
  if (!x.trim()) return null;
  const n = Number(x);
  return Number.isInteger(n) ? n : undefined;
};

const blank = (x: string | null | undefined) => x ?? '';

const orNull = (x: string) => (x.trim() ? x.trim() : null);

export const toDraft = (claim: ClaimDetail): Draft => ({
  patient: {
    addressLine: blank(claim.address_line),
    city: blank(claim.city),
    state: blank(claim.state),
    postalCode: blank(claim.postal_code)
  },
  coverages: claim.coverages.map((c) => ({
    id: c.id,
    payer: c.payer,
    memberId: blank(c.member_id),
    groupId: blank(c.group_id)
  })),
  serviceDate: blank(claim.service_date),
  pickup: {
    name: '',
    addressLine: blank(claim.pickup_address_line),
    city: blank(claim.pickup_city),
    state: blank(claim.pickup_state),
    postalCode: blank(claim.pickup_postal_code)
  },
  destination: {
    name: blank(claim.destination_name),
    addressLine: blank(claim.destination_address_line),
    city: blank(claim.destination_city),
    state: blank(claim.destination_state),
    postalCode: blank(claim.destination_postal_code)
  },
  diagnoses: claim.diagnoses.join(', '),
  originCode: blank(claim.origin_code),
  destinationCode: blank(claim.destination_code),
  signature: claim.signature,
  transportReason: blank(claim.transport_reason),
  pcsOnFile: answerOf(claim.pcs_on_file),
  pcsSignedOn: blank(claim.pcs_signed_on),
  pcsType: blank(claim.pcs_type),
  patientCount: claim.patient_count === null ? '' : String(claim.patient_count),
  abnOnFile: answerOf(claim.abn_on_file),
  abnSignedOn: blank(claim.abn_signed_on),
  denialExpected: answerOf(claim.denial_expected),
  mspEmployerPlan: answerOf(claim.msp_employer_plan),
  mspEsrd: answerOf(claim.msp_esrd),
  mspDisability: answerOf(claim.msp_disability),
  mspAccident: blank(claim.msp_accident),
  priorAuthorization: blank(claim.prior_authorization),
  priorAuthorizationExpiresOn: blank(claim.prior_authorization_expires_on),
  roundTrips: claim.round_trips === null ? '' : String(claim.round_trips),
  admissionDate: blank(claim.admission_date),
  facilityStay: blank(claim.facility_stay)
});

const fromLocation = (l: Record<keyof LocationInput, string>): LocationInput => ({
  name: orNull(l.name),
  addressLine: orNull(l.addressLine),
  city: orNull(l.city),
  state: orNull(l.state),
  postalCode: orNull(l.postalCode)
});

const changed = <T, V>(next: T, before: T, value: V): V | undefined =>
  next === before ? undefined : value;

const text = (d: Draft, before: Draft, key: TextKey) =>
  changed(d[key], before[key], orNull(d[key]));

const flag = (d: Draft, before: Draft, key: Flag) => changed(d[key], before[key], flagOf(d[key]));

const choice = <T extends string>(d: Draft, before: Draft, key: TextKey) =>
  changed(d[key], before[key], orNull(d[key]) as T | null);

const documentationOf = (d: Draft, before: Draft): BillingDataInput['documentation'] => {
  const doc: DocumentationInput = {
    signature: isSignatureStatus(d.signature)
      ? changed(d.signature, before.signature, d.signature)
      : undefined,
    pcsOnFile: flag(d, before, 'pcsOnFile'),
    pcsSignedOn: text(d, before, 'pcsSignedOn'),
    transportReason: isTransportReason(d.transportReason)
      ? changed(d.transportReason, before.transportReason, d.transportReason)
      : d.transportReason.trim()
        ? undefined
        : changed(d.transportReason, before.transportReason, null),
    patientCount: changed(d.patientCount, before.patientCount, countOf(d.patientCount)),
    abnOnFile: flag(d, before, 'abnOnFile'),
    abnSignedOn: text(d, before, 'abnSignedOn'),
    denialExpected: flag(d, before, 'denialExpected'),
    mspEmployerPlan: flag(d, before, 'mspEmployerPlan'),
    mspEsrd: flag(d, before, 'mspEsrd'),
    mspDisability: flag(d, before, 'mspDisability'),
    mspAccident: choice<MspAccident>(d, before, 'mspAccident'),
    priorAuthorization: text(d, before, 'priorAuthorization'),
    priorAuthorizationExpiresOn: text(d, before, 'priorAuthorizationExpiresOn'),
    pcsType: choice<PcsType>(d, before, 'pcsType'),
    roundTrips: changed(d.roundTrips, before.roundTrips, countOf(d.roundTrips)),
    admissionDate: text(d, before, 'admissionDate'),
    facilityStay: choice<FacilityStay>(d, before, 'facilityStay')
  };
  const sent: DocumentationInput = Object.fromEntries(
    Object.entries(doc).filter(([, v]) => v !== undefined)
  );
  return Object.keys(sent).length ? sent : null;
};

export const fromDraft = (d: Draft, before: Draft = d): BillingDataInput => ({
  patient: {
    addressLine: orNull(d.patient.addressLine),
    city: orNull(d.patient.city),
    state: orNull(d.patient.state),
    postalCode: orNull(d.patient.postalCode)
  },
  coverages: d.coverages.map((c) => ({
    id: c.id,
    memberId: orNull(c.memberId),
    groupId: orNull(c.groupId)
  })),
  serviceDate: orNull(d.serviceDate),
  pickup: fromLocation(d.pickup),
  destination: fromLocation(d.destination),
  diagnoses: d.diagnoses
    .split(/[\s,]+/)
    .map((x) => x.trim())
    .filter(Boolean),
  originDestination: d.originCode && d.destinationCode ? d.originCode + d.destinationCode : null,
  documentation: documentationOf(d, before)
});

const COUNT_KEYS = ['patientCount', 'roundTrips'] as const;

type CountKey = (typeof COUNT_KEYS)[number];

const COUNT_MINIMUMS: Readonly<Record<CountKey, number>> = { patientCount: 1, roundTrips: 0 };

export const countErrorOf = (d: Pick<Draft, CountKey>, key: CountKey) => {
  const x = d[key];
  if (!x.trim()) return undefined;
  const n = countOf(x);
  const min = COUNT_MINIMUMS[key];
  return n != null && n >= min ? undefined : `Enter a whole number of ${min} or more.`;
};

export const hasCountError = (d: Pick<Draft, CountKey>) =>
  COUNT_KEYS.some((k) => countErrorOf(d, k));

export const modifierErrorOf = (d: Pick<Draft, 'originCode' | 'destinationCode'>) =>
  Boolean(d.originCode) === Boolean(d.destinationCode)
    ? undefined
    : 'Choose both a pickup and a destination type, or neither.';

export const abnErrorOf = (d: Pick<Draft, 'abnOnFile' | 'abnSignedOn'>) =>
  d.abnSignedOn.trim() && d.abnOnFile !== 'yes'
    ? 'Answer yes to ABN on file before dating it, or clear the date.'
    : undefined;
