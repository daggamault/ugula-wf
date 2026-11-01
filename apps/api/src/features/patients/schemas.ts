import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';

const name = v.optional(v.pipe(v.string(), v.trim(), v.maxLength(60)));

export const PATIENT_SORTS = ['name', 'born', 'lastService', 'balance'] as const;

export type PatientSort = (typeof PATIENT_SORTS)[number];

export const listPatientsQuery = v.object({
  lastName: name,
  firstName: name,
  birthDate: v.optional(v.pipe(v.string(), v.isoDate('Use a date like 1980-01-31'))),
  ...pageEntries(PATIENT_SORTS, 'name', 'asc')
});
