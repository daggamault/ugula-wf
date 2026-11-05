import {
  ADJUSTMENT_GROUPS,
  ADJUSTMENT_REASON_PATTERN,
  DIAGNOSIS_LIMIT,
  DOCUMENT_KINDS,
  type DocumentKind,
  FACILITY_STAYS,
  ICD10_PATTERN,
  INSURED_RELATIONSHIPS,
  isOriginDestination,
  MAX_DOCUMENTED_COUNT,
  MSP_ACCIDENTS,
  PCS_TYPES,
  SIGNATURE_STATUSES,
  TRANSPORT_REASONS,
  type TransportReason,
  US_STATE_PATTERN,
  ZIP_CODE_PATTERN
} from '@ugula/billing';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';

const cents = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000_000));

const CLAIM_SORTS = [
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

const name = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)));

export const listClaimsQuery = v.object({
  status: v.optional(v.picklist(['open', 'all']), 'open'),
  firstName: name,
  lastName: name,
  birthDate: v.optional(v.pipe(v.string(), v.isoDate('Use a date like 1980-01-02'))),
  number: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
  patientId: v.optional(uuid),
  ...pageEntries(CLAIM_SORTS, 'created', 'desc')
});

const CLAIM_EVENT_SORTS = ['when', 'event', 'payer', 'amount'] as const;

export type ClaimEventSort = (typeof CLAIM_EVENT_SORTS)[number];

export const claimEventsQuery = v.object(pageEntries(CLAIM_EVENT_SORTS, 'when', 'desc'));

const payerName = v.pipe(
  v.string(),
  v.trim(),
  v.nonEmpty('Payer names cannot be blank'),
  v.maxLength(60)
);

const insuredName = v.optional(
  v.nullable(
    v.pipe(
      v.string(),
      v.trim(),
      v.maxLength(60),
      v.transform((s) => s || null)
    )
  ),
  null
);

const payerEntry = v.union([
  v.pipe(
    payerName,
    v.transform((name) => ({
      name,
      relationship: INSURED_RELATIONSHIPS[0],
      insuredFirstName: null,
      insuredLastName: null
    }))
  ),
  v.object({
    name: payerName,
    relationship: v.optional(v.picklist(INSURED_RELATIONSHIPS), INSURED_RELATIONSHIPS[0]),
    insuredFirstName: insuredName,
    insuredLastName: insuredName
  })
]);

export type PayerEntry = v.InferOutput<typeof payerEntry>;

export const payersSchema = v.object({
  payers: v.pipe(
    v.array(payerEntry),
    v.maxLength(10),
    v.check(
      (xs) => new Set(xs.map((x) => x.name.toLowerCase())).size === xs.length,
      'Each payer can only be listed once'
    )
  )
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

const adjustmentSchema = v.object({
  group: v.picklist(Object.keys(ADJUSTMENT_GROUPS) as (keyof typeof ADJUSTMENT_GROUPS)[]),
  reason: v.pipe(
    v.string(),
    v.trim(),
    v.toUpperCase(),
    v.regex(new RegExp(ADJUSTMENT_REASON_PATTERN), 'Use a reason code like 45 or CO45')
  ),
  cents: v.pipe(
    v.number(),
    v.integer(),
    v.minValue(-100_000_000),
    v.maxValue(100_000_000),
    v.check((n) => n !== 0, 'An adjustment needs an amount')
  )
});

const RESPONSE_KINDS = ['response', 'refunded'] as const;

export const responseSchema = v.pipe(
  v.object({
    requestId: uuid,
    kind: v.optional(v.picklist(RESPONSE_KINDS), 'response'),
    coverageId: v.optional(v.nullable(uuid), null),
    paidCents: v.optional(cents, 0),
    adjustedCents: v.optional(cents, 0),
    paidOn: v.optional(
      v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'))),
      null
    ),
    checkNumber: optionalText(50),
    payerClaimNumber: optionalText(50),
    adjustments: v.optional(v.pipe(v.array(adjustmentSchema), v.maxLength(99)), []),
    note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), '')
  }),
  v.forward(
    v.check(
      (r) => r.kind === 'response' || (r.paidCents > 0 && r.adjustedCents === 0),
      'A refund needs an amount paid back and no adjustment'
    ),
    ['paidCents']
  ),
  v.forward(
    v.check(
      (r) => r.kind === 'response' || !r.adjustments.length,
      'A refund carries no reason codes'
    ),
    ['adjustments']
  )
);

export const recordsRequestSchema = v.object({
  dueOn: v.optional(v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-12-01'))), null),
  note: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(500)), '')
});

export type RecordsRequest = v.InferOutput<typeof recordsRequestSchema>;

export const facilitySchema = v.object({ facilityId: v.nullable(uuid) });
const isoDay = v.optional(
  v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'))),
  null
);

const flag = v.optional(v.nullable(v.boolean()), null);

const count = (min: number) =>
  v.optional(
    v.nullable(v.pipe(v.number(), v.integer(), v.minValue(min), v.maxValue(MAX_DOCUMENTED_COUNT))),
    null
  );

const choiceOf = <T extends Record<string, string>>(labels: T) =>
  v.optional(
    v.nullable(v.picklist(Object.keys(labels) as [keyof T & string, ...(keyof T & string)[]])),
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
        v.nullable(
          v.pipe(v.string(), v.regex(new RegExp(US_STATE_PATTERN), 'Use a 2-letter state'))
        )
      )
    ),
    null
  ),
  postalCode: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.transform((s) => s.replace(/\D/g, '') || null),
        v.nullable(
          v.pipe(v.string(), v.regex(new RegExp(ZIP_CODE_PATTERN), 'Use a 5 or 9 digit ZIP code'))
        )
      )
    ),
    null
  )
});

const locationSchema = v.object({ name: optionalText(60), ...addressSchema.entries });

export const billingDataSchema = v.object({
  patient: v.optional(v.nullable(addressSchema), null),
  coverages: v.optional(
    v.pipe(
      v.array(
        v.object({
          id: uuid,
          memberId: optionalText(80),
          groupId: optionalText(50),
          relationship: v.optional(v.nullable(v.picklist(INSURED_RELATIONSHIPS)), null),
          insuredFirstName: optionalText(60),
          insuredLastName: optionalText(60),
          remove: v.optional(v.boolean(), false)
        })
      ),
      v.maxLength(10)
    ),
    []
  ),
  serviceDate: v.optional(
    v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'))),
    null
  ),
  pickup: v.optional(v.nullable(locationSchema), null),
  destination: v.optional(v.nullable(locationSchema), null),
  diagnoses: v.optional(
    v.nullable(
      v.pipe(
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
      )
    ),
    null
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
  ),
  documentation: v.optional(
    v.nullable(
      v.object({
        signature: v.optional(v.nullable(v.picklist(SIGNATURE_STATUSES)), null),
        pcsOnFile: v.optional(v.nullable(v.boolean()), null),
        pcsSignedOn: isoDay,
        transportReason: v.optional(
          v.nullable(
            v.picklist(Object.keys(TRANSPORT_REASONS) as [TransportReason, ...TransportReason[]])
          ),
          null
        ),
        patientCount: count(1),
        abnOnFile: flag,
        abnSignedOn: isoDay,
        denialExpected: flag,
        mspEmployerPlan: flag,
        mspEsrd: flag,
        mspDisability: flag,
        mspAccident: choiceOf(MSP_ACCIDENTS),
        priorAuthorization: optionalText(50),
        priorAuthorizationExpiresOn: isoDay,
        pcsType: choiceOf(PCS_TYPES),
        roundTrips: count(0),
        admissionDate: isoDay,
        facilityStay: choiceOf(FACILITY_STAYS)
      })
    ),
    null
  ),
  note: optionalText(500)
});

export type BillingData = v.InferOutput<typeof billingDataSchema>;

const documentKind = v.picklist(Object.keys(DOCUMENT_KINDS) as [DocumentKind, ...DocumentKind[]]);

export const documentFormSchema = v.object({
  file: v.instance(File),
  kind: documentKind,
  signedOn: v.optional(
    v.pipe(
      v.string(),
      v.trim(),
      v.transform((s) => s || null),
      v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01')))
    ),
    ''
  )
});

export const documentParam = v.object({ id: uuid, documentId: uuid });

export const chaseSchema = v.object({ kind: documentKind, note: optionalText(500) });

export type ChaseRequest = v.InferOutput<typeof chaseSchema>;

export type ClaimResponse = v.InferOutput<typeof responseSchema>;
