import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

const TABLE_SORTS = ['name', 'key', 'updated'] as const;

export type TableSort = (typeof TABLE_SORTS)[number];

const TABLE_SHOWS = ['all', 'customized'] as const;

export type TableShow = (typeof TABLE_SHOWS)[number];

const DEFINITION_MAX_CHARS = 500_000;

export const searchTablesQuery = v.object({
  q: searchText,
  show: v.optional(v.picklist(TABLE_SHOWS), 'all'),
  ...pageEntries(TABLE_SORTS, 'name', 'asc')
});

export const overrideTableSchema = v.object({
  scope: v.optional(v.picklist(['organization', 'agency']), 'agency')
});

export const tableDefinitionSchema = v.object({
  definition: v.pipe(
    v.unknown(),
    v.check(
      (def) => JSON.stringify(def ?? null).length <= DEFINITION_MAX_CHARS,
      'The table is too large to save'
    )
  )
});

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
