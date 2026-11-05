import type { Db, TableKind } from '@ugula/db';
import { type Json, tableContract } from '@ugula/graph';
import { sql } from 'kysely';
import { type Page, type PageRequest, paged } from '../../shared/paging.ts';
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
import type { TableShow, TableSort } from './schemas.ts';

export type TableFilters = PageRequest<TableSort> & {
  q?: string | undefined;
  show: TableShow;
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
  key: sql.ref('t.key'),
  updated: sql.ref('t.updated_at')
};

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

export const searchTables = async (
  db: Db,
  s: ScopeIds,
  f: TableFilters
): Promise<Page<TableSummary>> => {
  let q = db
    .selectFrom('data_tables as t')
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
    ])
    .where(visible('t', s));
  if (f.show === 'customized') {
    q = q.where((eb) =>
      eb.or([eb(overriddenBy(s), 'is not', null), eb(overridesOf(s), 'is not', null)])
    );
  }
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([eb(sql`lower(t.name)`, 'like', like), eb(sql`lower(t.key)`, 'like', like)])
    );
  }
  const page = await paged(q, f, TABLE_ORDER, sql.ref('t.id'));
  return { ...page, items: page.items.map((r) => toSummary(r as TableRow)) };
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
    organizationId: string;
    agencyId: string | null;
    key: string;
    name: string;
    kind: TableKind;
    description: string;
  }
) =>
  db
    .insertInto('data_tables')
    .values({
      organization_id: input.organizationId,
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
      created_by: input.userId
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
