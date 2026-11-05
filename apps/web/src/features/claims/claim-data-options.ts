import {
  FACILITY_STAYS,
  MSP_ACCIDENTS,
  ORIGIN_DESTINATION_CODES,
  PCS_TYPES,
  SIGNATURE_LABELS,
  SIGNATURE_STATUSES,
  TRANSPORT_REASONS
} from '@ugula/billing';
import type { Flag } from './claim-data-draft.ts';

const MODIFIER_OPTIONS = Object.entries(ORIGIN_DESTINATION_CODES).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`
}));

const NOT_SET = { value: '', label: 'Not Set' };

export const ORIGIN_OPTIONS = [NOT_SET, ...MODIFIER_OPTIONS.filter((o) => o.value !== 'X')];

export const DESTINATION_OPTIONS = [NOT_SET, ...MODIFIER_OPTIONS];

export const SIGNATURE_OPTIONS = SIGNATURE_STATUSES.map((value) => ({
  value,
  label: SIGNATURE_LABELS[value]
}));

export const TRANSPORT_REASON_OPTIONS = [
  NOT_SET,
  ...Object.entries(TRANSPORT_REASONS).map(([value, label]) => ({
    value,
    label: `${value} · ${label}`
  }))
];

export const PCS_OPTIONS = [
  { value: '', label: 'Unknown' },
  { value: 'yes', label: 'On File' },
  { value: 'no', label: 'Not on File' }
];

export const YES_NO = [
  { value: '', label: 'Unknown' },
  { value: 'yes', label: 'Yes' },
  { value: 'no', label: 'No' }
];

const choicesOf = (labels: Readonly<Record<string, string>>) => [
  { value: '', label: 'Unknown' },
  ...Object.entries(labels).map(([value, label]) => ({ value, label }))
];

export const MSP_ACCIDENT_OPTIONS = choicesOf(MSP_ACCIDENTS);

export const PCS_TYPE_OPTIONS = choicesOf(PCS_TYPES);

export const FACILITY_STAY_OPTIONS = choicesOf(FACILITY_STAYS);

export const MSP_QUESTIONS: { key: Flag; label: string; hint: string }[] = [
  {
    key: 'mspEmployerPlan',
    label: 'Employer Group Health Plan',
    hint: 'Covered through the patient’s or spouse’s current employment'
  },
  {
    key: 'mspEsrd',
    label: 'End-Stage Renal Disease',
    hint: 'In the 30-month coordination period'
  },
  {
    key: 'mspDisability',
    label: 'Disability With a Large Group Plan',
    hint: 'Under 65, covered through a plan of 100 or more employees'
  }
];
