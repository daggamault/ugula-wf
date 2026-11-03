import {
  CLAIM_STATUSES,
  DIAGNOSIS_LIMIT,
  ICD10_PATTERN,
  isOriginDestination
} from '@ugula/billing';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';

const cents = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000_000));

export const CLAIM_SORTS = [
  'created',
  'number',
  'service',
  'patient',
  'pcr',
  'total',
  'balance',
  'status',
  'waiting'
] as const;

export type ClaimSort = (typeof CLAIM_SORTS)[number];

export const CLAIM_FILTERS = ['open', 'all', ...CLAIM_STATUSES] as const;

const name = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)));

export const listClaimsQuery = v.object({
  status: v.optional(v.picklist(CLAIM_FILTERS), 'open'),
  firstName: name,
  lastName: name,
  birthDate: v.optional(v.pipe(v.string(), v.isoDate('Use a date like 1980-01-02'))),
  number: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
  patientId: v.optional(uuid),
  task: v.optional(v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(60))),
  assignee: v.optional(v.picklist(['anyone', 'me', 'unassigned']), 'anyone'),
  ...pageEntries(CLAIM_SORTS, 'created', 'desc')
});

export const payersSchema = v.object({
  payers: v.pipe(
    v.array(v.pipe(v.string(), v.trim(), v.nonEmpty('Payer names cannot be blank'))),
    v.maxLength(10),
    v.check((xs) => new Set(xs).size === xs.length, 'Each payer can only be listed once')
  )
});

export const responseSchema = v.object({
  requestId: uuid,
  coverageId: v.optional(v.nullable(uuid), null),
  paidCents: v.optional(cents, 0),
  adjustedCents: v.optional(cents, 0),
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), '')
});

const optionalText = (max: number) =>
  v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.maxLength(max),
        v.transform((s) => s || null)
      )
    ),
    null
  );

const addressSchema = v.object({
  addressLine: optionalText(55),
  city: optionalText(30),
  state: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.toUpperCase(),
        v.transform((s) => s || null),
        v.nullable(v.pipe(v.string(), v.regex(/^[A-Z]{2}$/, 'Use a 2-letter state')))
      )
    ),
    null
  ),
  postalCode: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.transform((s) => s.replace(/\D/g, '') || null),
        v.nullable(v.pipe(v.string(), v.regex(/^(\d{5}|\d{9})$/, 'Use a 5 or 9 digit ZIP code')))
      )
    ),
    null
  )
});

const locationSchema = v.object({ name: optionalText(60), ...addressSchema.entries });

export const billingDataSchema = v.object({
  patient: addressSchema,
  coverages: v.pipe(
    v.array(
      v.object({
        id: uuid,
        memberId: optionalText(80),
        groupId: optionalText(50)
      })
    ),
    v.maxLength(10)
  ),
  serviceDate: v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'))),
  pickup: locationSchema,
  destination: locationSchema,
  diagnoses: v.pipe(
    v.array(
      v.pipe(
        v.string(),
        v.trim(),
        v.toUpperCase(),
        v.transform((s) => s.replace('.', '')),
        v.regex(new RegExp(ICD10_PATTERN), 'Use ICD-10-CM codes like R07.9')
      )
    ),
    v.maxLength(DIAGNOSIS_LIMIT),
    v.transform((xs) => [...new Set(xs)])
  ),
  originDestination: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.toUpperCase(),
        v.check((s) => isOriginDestination(s), 'Use two origin/destination letters like RH')
      )
    ),
    null
  )
});

export type BillingData = v.InferOutput<typeof billingDataSchema>;
