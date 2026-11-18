import {
  CLAIM_STATUSES,
  CONDITION_LIMIT,
  DIAGNOSIS_LIMIT,
  INSURED_RELATIONSHIPS,
  MAX_LINE_MODIFIERS,
  NOTE_LENGTH,
  SERVICE_LEVELS,
  SEXES
} from '@ugula/billing';
import * as v from 'valibot';
import { facetValues } from '../../shared/facets.ts';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';

const CLAIM_SORTS = [
  'created',
  'number',
  'service',
  'patient',
  'pcr',
  'encounter',
  'total',
  'status'
] as const;

export type ClaimSort = (typeof CLAIM_SORTS)[number];

const name = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)));

export const searchClaimsQuery = v.object({
  status: facetValues(v.picklist(CLAIM_STATUSES)),
  firstName: name,
  lastName: name,
  birthDate: v.optional(v.pipe(v.string(), v.isoDate('Use a date like 1980-01-02'))),
  number: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
  patientId: v.optional(uuid),
  ...pageEntries(CLAIM_SORTS, 'created', 'desc')
});

const text = (max: number) => v.nullable(v.pipe(v.string(), v.trim(), v.maxLength(max)));

const place = v.object({
  name: text(60),
  line: text(55),
  city: text(30),
  state: text(2),
  postalCode: text(10)
});

export const editClaimSchema = v.object({
  revision: v.pipe(v.number(), v.integer(), v.minValue(1)),
  serviceDate: v.nullable(v.pipe(v.string(), v.isoDate('Use a date like 2026-10-01'))),
  level: v.picklist(SERVICE_LEVELS),
  emergency: v.boolean(),
  loadedMiles: v.nullable(v.pipe(v.number(), v.minValue(0), v.maxValue(10_000))),
  originCode: text(1),
  destinationCode: text(1),
  transportReason: text(1),
  conditionCodes: v.pipe(v.array(v.string()), v.maxLength(CONDITION_LIMIT)),
  weightPounds: v.nullable(v.number()),
  diagnoses: v.pipe(v.array(v.string()), v.maxLength(DIAGNOSIS_LIMIT)),
  patient: v.object({
    firstName: v.pipe(v.string(), v.trim(), v.nonEmpty('Enter the first name'), v.maxLength(35)),
    lastName: v.pipe(v.string(), v.trim(), v.nonEmpty('Enter the last name'), v.maxLength(60)),
    birthDate: v.pipe(v.string(), v.isoDate('Use a date like 1980-01-02')),
    sex: v.nullable(v.picklist(SEXES)),
    addressLine: text(55),
    city: text(30),
    state: text(2),
    postalCode: text(10)
  }),
  pickup: place,
  destination: place,
  priorAuthorization: text(50),
  signatureOnFile: v.boolean(),
  note: text(NOTE_LENGTH),
  coverages: v.pipe(
    v.array(
      v.object({
        payerId: v.nullable(uuid),
        payerName: v.pipe(v.string(), v.trim(), v.nonEmpty('Name every payer'), v.maxLength(60)),
        memberId: text(80),
        groupId: text(50),
        relationship: v.picklist(INSURED_RELATIONSHIPS),
        insuredFirstName: text(35),
        insuredLastName: text(60)
      })
    ),
    v.maxLength(10)
  ),
  lines: v.pipe(
    v.array(
      v.object({
        code: v.pipe(v.string(), v.trim()),
        modifiers: v.pipe(v.array(v.string()), v.maxLength(MAX_LINE_MODIFIERS)),
        units: v.pipe(v.number(), v.minValue(0.01), v.maxValue(10_000)),
        unitCents: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(100_000_000))
      })
    ),
    v.maxLength(50)
  )
});

export type ClaimEdit = v.InferOutput<typeof editClaimSchema>;
