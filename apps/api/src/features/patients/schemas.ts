import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';

const name = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)));

const PATIENT_SORTS = [
  'name',
  'number',
  'born',
  'lastService',
  'balance',
  'city',
  'claims'
] as const;

export type PatientSort = (typeof PATIENT_SORTS)[number];

export const listPatientsQuery = v.pipe(
  v.object({
    lastName: name,
    firstName: name,
    birthDate: v.optional(v.pipe(v.string(), v.isoDate('Use a date like 1980-01-31'))),
    number: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(40))),
    ...pageEntries(PATIENT_SORTS, 'name', 'asc')
  }),
  v.check(
    (q) => Boolean(q.lastName || q.firstName || q.birthDate || q.number),
    'Search by last name, first name, birth date or patient number'
  )
);
