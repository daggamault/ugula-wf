import { US_STATE_PATTERN, ZIP_CODE_PATTERN } from '@ugula/billing';
import * as v from 'valibot';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const optionalText = (max: number) =>
  v.optional(
    v.pipe(
      v.nullable(v.string()),
      v.transform((s) => s?.trim() || null),
      v.nullable(v.pipe(v.string(), v.maxLength(max)))
    ),
    null
  );

export const facilitySchema = v.object({
  name: v.pipe(v.string(), v.trim(), v.nonEmpty(), v.maxLength(80)),
  addressLine: optionalText(55),
  city: optionalText(30),
  state: v.optional(
    v.nullable(
      v.pipe(v.string(), v.trim(), v.toUpperCase(), v.regex(new RegExp(US_STATE_PATTERN)))
    ),
    null
  ),
  postalCode: v.optional(
    v.nullable(
      v.pipe(
        v.string(),
        v.trim(),
        v.regex(new RegExp(ZIP_CODE_PATTERN), 'Use a 5 or 9 digit ZIP code')
      )
    ),
    null
  ),
  phone: optionalText(20)
});

export type FacilityInput = v.InferOutput<typeof facilitySchema>;

const FACILITY_SORTS = ['name', 'city'] as const;

export type FacilitySort = (typeof FACILITY_SORTS)[number];

export const searchFacilitiesQuery = v.object({
  q: searchText,
  ...pageEntries(FACILITY_SORTS, 'name', 'asc')
});
