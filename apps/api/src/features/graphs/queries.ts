import type { Database, GraphKind } from '@ugula/db';
import type { GraphDef } from '@ugula/graph';
import { type Kysely, sql } from 'kysely';

import { type Page, type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { GraphShow, GraphSort } from './schemas.ts';

type Db = Kysely<Database>;

export type GraphSummary = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  isSystem: boolean;
  overrides: boolean;
  overriddenBy: string | null;
  publishedVersion: number | null;
  draftVersion: number | null;
  updatedAt: Date;
};

export type GraphFilters = PageRequest<GraphSort> & {
  q?: string | undefined;
  show: GraphShow;
};

type GraphRow = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  description: string;
  tenant_id: string | null;
  updated_at: Date;
  published: number | null;
  draft: number | null;
  overridden_by: string | null;
  overrides: boolean;
};

const GRAPH_ORDER = {
  name: sql`lower(g.name)`,
  key: sql.ref('g.key'),
  kind: sql`(g.kind, lower(g.name))`,
  updated: sql.ref('g.updated_at')
};

const toSummary = (r: GraphRow): GraphSummary => ({
  id: r.id,
  key: r.key,
  name: r.name,
  kind: r.kind,
  description: r.description,
  isSystem: r.tenant_id === null,
  overrides: r.overrides,
  overriddenBy: r.overridden_by,
  publishedVersion: r.published,
  draftVersion: r.draft,
  updatedAt: r.updated_at
});

/** Tenant and system graphs whose name or key contains `q`, of the kind shown, a page at a time. */
export const searchGraphs = async (
  db: Db,
  tenantId: string,
  f: GraphFilters
): Promise<Page<GraphSummary>> => {
  let q = db
    .selectFrom('graphs as g')
    // One lookup per graph for both its latest published and draft versions.
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('graph_versions as gv')
          .select([
            sql<number | null>`max(gv.version) filter (where gv.published_at is not null)`.as(
              'published'
            ),
            sql<number | null>`max(gv.version) filter (where gv.published_at is null)`.as('draft')
          ])
          .whereRef('gv.graph_id', '=', 'g.id')
          .as('v'),
      (join) => join.onTrue()
    )
    .select([
      'g.id',
      'g.key',
      'g.name',
      'g.kind',
      'g.description',
      'g.tenant_id',
      'g.updated_at',
      'v.published',
      'v.draft',
      sql<string | null>`(
        select o.id from graphs o
        where o.key = g.key and g.tenant_id is null and o.tenant_id = ${tenantId} and o.is_active
      )`.as('overridden_by'),
      sql<boolean>`g.tenant_id is not null and exists (
        select 1 from graphs s where s.key = g.key and s.tenant_id is null
      )`.as('overrides')
    ])
    .where((eb) =>
      eb.or([
        eb('g.tenant_id', 'is', null),
        eb.and([eb('g.tenant_id', '=', tenantId), eb('g.is_active', '=', true)])
      ])
    );
  if (f.show === 'workflows') q = q.where('g.kind', '=', 'workflow');
  if (f.show === 'blocks') q = q.where('g.kind', '!=', 'workflow');
  if (f.show === 'mine') q = q.where('g.tenant_id', 'is not', null);
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([eb(sql`lower(g.name)`, 'like', like), eb(sql`lower(g.key)`, 'like', like)])
    );
  }
  const page = await paged(q, f, GRAPH_ORDER, sql.ref('g.id'));
  return { ...page, items: page.items.map((r) => toSummary(r as GraphRow)) };
};

export const findGraph = (db: Db, tenantId: string, id: string) =>
  db
    .selectFrom('graphs as g')
    .select([
      'g.id',
      'g.tenant_id',
      'g.key',
      'g.name',
      'g.kind',
      'g.description',
      sql<string | null>`(
        select o.id from graphs o
        where o.key = g.key and g.tenant_id is null and o.tenant_id = ${tenantId} and o.is_active
      )`.as('overridden_by'),
      sql<string | null>`(
        select s.id from graphs s
        where s.key = g.key and g.tenant_id is not null and s.tenant_id is null
      )`.as('overrides')
    ])
    .where('g.id', '=', id)
    .where((eb) =>
      eb.or([
        eb('g.tenant_id', 'is', null),
        eb.and([eb('g.tenant_id', '=', tenantId), eb('g.is_active', '=', true)])
      ])
    )
    .executeTakeFirst();

export const listVersions = (db: Db, graphId: string) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version', 'published_at', 'created_at', 'updated_at'])
    .where('graph_id', '=', graphId)
    .orderBy('version', 'desc')
    .execute();

export const findVersion = (db: Db, graphId: string, version: number) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version', 'definition', 'published_at'])
    .where('graph_id', '=', graphId)
    .where('version', '=', version)
    .executeTakeFirst();

export const findDefinition = async (db: Db, versionId: string) =>
  (
    await db
      .selectFrom('graph_versions')
      .select('definition')
      .where('id', '=', versionId)
      .executeTakeFirstOrThrow()
  ).definition as GraphDef;

export const insertGraph = (
  db: Db,
  input: { tenantId: string; key: string; name: string; kind: GraphKind; description: string }
) =>
  db
    .insertInto('graphs')
    .values({
      tenant_id: input.tenantId,
      key: input.key,
      name: input.name,
      kind: input.kind,
      description: input.description
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const lockDraft = (db: Db, graphId: string) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version'])
    .where('graph_id', '=', graphId)
    .where('published_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

export const nextVersion = async (db: Db, graphId: string) =>
  ((
    await db
      .selectFrom('graph_versions')
      .select((eb) => eb.fn.max('version').as('max'))
      .where('graph_id', '=', graphId)
      .executeTakeFirst()
  )?.max ?? 0) + 1;

export const insertDraft = (
  db: Db,
  input: { graphId: string; version: number; definition: GraphDef; userId: string }
) =>
  db
    .insertInto('graph_versions')
    .values({
      graph_id: input.graphId,
      version: input.version,
      definition: JSON.stringify(input.definition),
      created_by: input.userId
    })
    .returning(['id', 'version'])
    .executeTakeFirstOrThrow();

export const updateDraft = (db: Db, id: string, definition: GraphDef) =>
  db
    .updateTable('graph_versions')
    .set({ definition: JSON.stringify(definition), updated_at: sql`now()` })
    .where('id', '=', id)
    .where('published_at', 'is', null)
    .execute();

export const publishVersion = async (db: Db, id: string, dependencies: string[]) => {
  await db
    .updateTable('graph_versions')
    .set({ published_at: sql`now()`, dependencies, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('published_at', 'is', null)
    .execute();
};

export const touchGraph = async (db: Db, id: string) => {
  await db.updateTable('graphs').set({ updated_at: sql`now()` }).where('id', '=', id).execute();
};

export const listPublishedNodes = (db: Db, tenantId: string) =>
  db
    .selectFrom('graph_versions as gv')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .select([
      'g.id as graph_id',
      'g.key',
      'g.name',
      'g.kind',
      'g.description',
      'gv.version',
      sql<GraphDef['signature']>`gv.definition -> 'signature'`.as('signature')
    ])
    .where('gv.published_at', 'is not', null)
    .where((eb) =>
      eb.or([
        eb('g.tenant_id', 'is', null),
        eb.and([
          eb('g.tenant_id', '=', tenantId),
          eb.not(
            eb.exists(
              eb
                .selectFrom('graphs as s')
                .select('s.id')
                .whereRef('s.key', '=', 'g.key')
                .where('s.tenant_id', 'is', null)
            )
          )
        ])
      ])
    )
    .orderBy('g.key')
    .orderBy('gv.version', 'desc')
    .execute();

export const findSystemGraph = (db: Db, key: string) =>
  db
    .selectFrom('graphs')
    .select(['id', 'key', 'name', 'kind', 'description'])
    .where('key', '=', key)
    .where('tenant_id', 'is', null)
    .executeTakeFirst();

export const findLatestPublished = (db: Db, graphId: string) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version', 'definition'])
    .where('graph_id', '=', graphId)
    .where('published_at', 'is not', null)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();

export const findTenantGraph = (db: Db, tenantId: string, key: string) =>
  db
    .selectFrom('graphs')
    .select(['id', 'is_active'])
    .where('tenant_id', '=', tenantId)
    .where('key', '=', key)
    .executeTakeFirst();

export const setGraphActive = (db: Db, tenantId: string, id: string, active: boolean) =>
  db
    .updateTable('graphs')
    .set({ is_active: active, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst();

export const deleteGraph = (db: Db, tenantId: string, id: string) =>
  db
    .deleteFrom('graphs')
    .where('id', '=', id)
    .where('tenant_id', '=', tenantId)
    .returning('id')
    .executeTakeFirst();
