import { CLAIM_TASK_KEYS } from '@ugula/billing';
import * as v from 'valibot';
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

export const startTaskSchema = v.object({ workflow: v.picklist(CLAIM_TASK_KEYS) });

export const documentParam = v.object({ id: uuid, documentId: uuid });
