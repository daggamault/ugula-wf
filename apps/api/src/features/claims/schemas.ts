import { CLAIM_STATUSES } from '@ugula/billing';
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
