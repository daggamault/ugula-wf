import { graphDefSchema } from '@ugula/graph';
import * as v from 'valibot';
import { uuid } from '../../shared/http.ts';
import { pageEntries } from '../../shared/paging.ts';
import { searchText } from '../../shared/search.ts';

export const GRAPH_SORTS = ['name', 'key', 'kind', 'updated'] as const;

export type GraphSort = (typeof GRAPH_SORTS)[number];

export const GRAPH_SHOWS = ['workflows', 'blocks', 'mine', 'all'] as const;

export type GraphShow = (typeof GRAPH_SHOWS)[number];

export const searchGraphsQuery = v.object({
  q: searchText,
  show: v.optional(v.picklist(GRAPH_SHOWS), 'workflows'),
  ...pageEntries(GRAPH_SORTS, 'name', 'asc')
});

export const createGraphSchema = v.object({
  key: v.pipe(
    v.string(),
    v.trim(),
    v.toLowerCase(),
    v.regex(
      /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/,
      'Use dotted lowercase keys like billing.match-patient'
    ),
    v.check((key) => !key.startsWith('std.'), 'The std namespace is reserved')
  ),
  name: v.pipe(v.string(), v.trim(), v.nonEmpty()),
  kind: v.picklist(['workflow', 'node']),
  description: v.optional(v.pipe(v.string(), v.trim()), '')
});

export const definitionSchema = v.object({ definition: graphDefSchema });

export const versionParam = v.object({
  id: uuid,
  version: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1))
});
