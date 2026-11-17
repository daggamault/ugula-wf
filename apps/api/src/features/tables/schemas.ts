import { AGENCY_TABLE_PREFIX, TABLE_KINDS } from '@ugula/db';
import * as v from 'valibot';
import { facetValues } from '../../shared/facets.ts';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { SCOPES } from '../../shared/scopes.ts';
import { searchText } from '../../shared/search.ts';

const TABLE_SORTS = ['name', 'updated'] as const;

export type TableSort = (typeof TABLE_SORTS)[number];

const DEFINITION_MAX_CHARS = 500_000;

const slugOf = (name: string) =>
  name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '');

export const agencyTableKey = (name: string) => `${AGENCY_TABLE_PREFIX}${slugOf(name)}`;

export const searchTablesQuery = v.object({
  q: searchText,
  kind: facetValues(v.picklist(TABLE_KINDS)),
  scope: facetValues(v.picklist(SCOPES)),
  ...pageEntries(TABLE_SORTS, 'name', 'asc')
});

const definition = v.pipe(
  v.unknown(),
  v.check(
    (def) => JSON.stringify(def ?? null).length <= DEFINITION_MAX_CHARS,
    'The table is too large to save'
  )
);

export const tableDefinitionSchema = v.object({ definition });

export const createTableSchema = v.object({
  name: v.pipe(
    v.string(),
    v.trim(),
    v.nonEmpty(),
    v.maxLength(120),
    v.check((name) => slugOf(name) !== '', 'Use a name with at least one letter')
  ),
  kind: v.picklist(TABLE_KINDS),
  description: v.optional(v.pipe(v.string(), v.trim(), v.maxLength(2000)), ''),
  definition
});

export type NewTable = v.InferOutput<typeof createTableSchema>;

export const tableVersionParam = v.object({
  id: uuid,
  version: v.pipe(
    v.string(),
    v.transform(Number),
    v.integer(),
    v.minValue(1),
    v.maxValue(2_147_483_647)
  )
});
