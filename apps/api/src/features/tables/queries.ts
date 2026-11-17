import { type Db, resolvedTable, type TableKind } from '@ugula/db';
import { type Json, tableContract } from '@ugula/graph';
import { sql } from 'kysely';
import { type FacetedPage, facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import {
  isStaleIn,
  overriddenByIn,
  overridesIn,
  type Scope,
  type ScopeIds,
  scopeOf,
  visible
} from '../../shared/scopes.ts';
import { containsPattern } from '../../shared/search.ts';
import type { TableSort } from './schemas.ts';

export type TableFilters = PageRequest<TableSort> & {
  q?: string | undefined;
  kind: readonly TableKind[];
  scope: readonly Scope[];
};

type TableRow = {
  id: string;
  key: string;
  name: string;
  kind: TableKind;
  description: string;
  scope: Scope;
  updated_at: Date;
  published: number | null;
  draft: number | null;
  overridden_by: string | null;
  overrides: string | null;
  is_stale: boolean;
};

const TABLE_ORDER = {
  name: sql`lower(t.name)`,
  updated: sql.ref('t.updated_at')
};

const TABLE_FACETS = {
  kind: { value: sql.ref('t.kind') },
  scope: { value: scopeOf('t') }
};

type TableFacet = keyof typeof TABLE_FACETS;

const overriddenBy = (s: ScopeIds) => overriddenByIn('data_tables', 't', s);

const overridesOf = (s: ScopeIds) => overridesIn('data_tables', 't', s);

const isStale = isStaleIn('data_tables', 't');

const toSummary = (r: TableRow) => ({
  id: r.id,
  key: r.key,
  name: r.name,
  kind: r.kind,
  description: r.description,
  scope: r.scope,
  overrides: r.overrides,
  overriddenBy: r.overridden_by,
  isStale: r.is_stale,
  publishedVersion: r.published,
  draftVersion: r.draft,
  updatedAt: r.updated_at
});

export type TableSummary = ReturnType<typeof toSummary>;

const filteredTables = (db: Db, s: ScopeIds, f: TableFilters, except?: TableFacet) => {
  let q = db.selectFrom('data_tables as t').where(visible('t', s));
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where(sql`lower(t.name)`, 'like', like);
  }
  return whereFacets(q, TABLE_FACETS, f, except);
};

export const searchTables = async (
  db: Db,
  s: ScopeIds,
  f: TableFilters
): Promise<FacetedPage<TableSummary, TableFacet>> => {
  const q = filteredTables(db, s, f)
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('data_table_versions as tv')
          .select([
            sql<number | null>`max(tv.version) filter (where tv.published_at is not null)`.as(
              'published'
            ),
            sql<number | null>`max(tv.version) filter (where tv.published_at is null)`.as('draft')
          ])
          .whereRef('tv.table_id', '=', 't.id')
          .as('v'),
      (join) => join.onTrue()
    )
    .select([
      't.id',
      't.key',
      't.name',
      't.kind',
      't.description',
      scopeOf('t').as('scope'),
      't.updated_at',
      'v.published',
      'v.draft',
      overriddenBy(s).as('overridden_by'),
      overridesOf(s).as('overrides'),
      isStale.as('is_stale')
    ]);
  const [page, facets] = await Promise.all([
    paged(q, f, TABLE_ORDER, sql.ref('t.id')),
    facetCounts((except) => filteredTables(db, s, f, except), TABLE_FACETS)
  ]);
  return { ...page, items: page.items.map((r) => toSummary(r as TableRow)), facets };
};

export const findTable = (db: Db, s: ScopeIds, id: string) =>
  db
    .selectFrom('data_tables as t')
    .select([
      't.id',
      't.key',
      't.name',
      't.kind',
      't.description',
      scopeOf('t').as('scope'),
      overriddenBy(s).as('overridden_by'),
      overridesOf(s).as('overrides'),
      isStale.as('is_stale')
    ])
    .where('t.id', '=', id)
    .where(visible('t', s))
    .executeTakeFirst();

export const listTableVersions = (db: Db, tableId: string) =>
  db
    .selectFrom('data_table_versions as v')
    .leftJoin('data_table_versions as b', 'b.id', 'v.base_version_id')
    .select([
      'v.id',
      'v.version',
      'v.published_at',
      'v.created_at',
      'v.updated_at',
      'b.version as base_version',
      'b.table_id as base_table_id'
    ])
    .where('v.table_id', '=', tableId)
    .orderBy('v.version', 'desc')
    .execute();

export const insertTable = (
  db: Db,
  input: {
    agencyId: string;
    key: string;
    name: string;
    kind: TableKind;
    description: string;
  }
) =>
  db
    .insertInto('data_tables')
    .values({
      agency_id: input.agencyId,
      key: input.key,
      name: input.name,
      kind: input.kind,
      description: input.description
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const insertTableDraft = (
  db: Db,
  input: {
    tableId: string;
    version: number;
    definition: Json;
    baseVersionId: string | null;
    userId: string;
  }
) =>
  db
    .insertInto('data_table_versions')
    .values({
      table_id: input.tableId,
      version: input.version,
      definition: JSON.stringify(input.definition),
      contract: tableContract(input.definition),
      base_version_id: input.baseVersionId,
      created_by_id: input.userId
    })
    .returning(['id', 'version'])
    .executeTakeFirstOrThrow();

export const updateTableDraft = (db: Db, id: string, definition: Json) =>
  db
    .updateTable('data_table_versions')
    .set({
      definition: JSON.stringify(definition),
      contract: tableContract(definition),
      updated_at: sql`now()`
    })
    .where('id', '=', id)
    .where('published_at', 'is', null)
    .execute();

export const publishTableVersion = async (db: Db, id: string) => {
  await db
    .updateTable('data_table_versions')
    .set({ published_at: sql`now()`, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('published_at', 'is', null)
    .execute();
};

type EffectiveRow = {
  id: string;
  key: string;
  name: string;
  scope: Scope;
  kind: TableKind;
  inputs: Json | null;
  outputs: Json | null;
  type: Json | null;
};

const buildEffectiveTables = (s: ScopeIds) => sql<EffectiveRow>`
  select t.id, t.key, t.name, ${scopeOf('t')} as scope, t.kind,
    v.definition -> 'inputs' as inputs, v.definition -> 'outputs' as outputs,
    v.definition -> 'type' as type
  from (select distinct k.key from data_tables k where ${visible('k', s)}) keys
  join data_table_versions v on v.id = ${resolvedTable(s.agencyId, sql.ref('keys.key'))}
  join data_tables t on t.id = v.table_id
  order by t.key`;

const toEffective = ({ inputs, outputs, type, ...r }: EffectiveRow) =>
  r.kind === 'decide'
    ? { ...r, kind: 'decide' as const, inputs: inputs ?? [], outputs: outputs ?? [] }
    : { ...r, kind: 'lookup' as const, type: type ?? 'string' };

export const listEffectiveTables = async (db: Db, s: ScopeIds) =>
  (await buildEffectiveTables(s).execute(db)).rows.map(toEffective);
