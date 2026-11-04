import type { Db, GraphKind, GraphRole } from '@ugula/db';
import { contractOf, type GraphDef } from '@ugula/graph';
import { type RawBuilder, sql } from 'kysely';
import { type Page, type PageRequest, paged } from '../../shared/paging.ts';
import { containsPattern } from '../../shared/search.ts';
import type { GraphShow, GraphSort } from './schemas.ts';

export const GRAPH_SCOPES = ['system', 'organization', 'agency'] as const;

export type GraphScope = (typeof GRAPH_SCOPES)[number];

export type ScopeIds = { agencyId: string; organizationId: string };

type GraphSummary = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  description: string;
  scope: GraphScope;
  isSystem: boolean;
  overrides: string | null;
  overriddenBy: string | null;
  isStale: boolean;
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
  role: GraphRole;
  description: string;
  scope: GraphScope;
  updated_at: Date;
  published: number | null;
  draft: number | null;
  overridden_by: string | null;
  overrides: string | null;
  is_stale: boolean;
};

const GRAPH_ORDER = {
  name: sql`lower(g.name)`,
  key: sql.ref('g.key'),
  kind: sql`(g.kind, lower(g.name))`,
  updated: sql.ref('g.updated_at')
};

const scopeOf = (alias: string) =>
  sql<GraphScope>`case when ${sql.ref(`${alias}.agency_id`)} is not null then 'agency'
    when ${sql.ref(`${alias}.organization_id`)} is not null then 'organization'
    else 'system' end`;

const rankOf = (alias: string) =>
  sql<number>`case when ${sql.ref(`${alias}.agency_id`)} is not null then 0
    when ${sql.ref(`${alias}.organization_id`)} is not null then 1 else 2 end`;

const visible = (alias: string, s: ScopeIds) => {
  const a = (c: string) => sql.ref(`${alias}.${c}`);
  return sql<boolean>`(
    ${a('organization_id')} is null
    or (${a('is_active')} and ${a('agency_id')} = ${s.agencyId}::uuid)
    or (${a('is_active')} and ${a('agency_id')} is null and ${a('organization_id')} = ${s.organizationId}::uuid)
  )`;
};

const overriddenBy = (s: ScopeIds): RawBuilder<string | null> => sql`(
  select o.id from graphs o
  where o.key = g.key and ${visible('o', s)} and ${rankOf('o')} < ${rankOf('g')}
  order by ${rankOf('o')} limit 1
)`;

const overridesOf = (s: ScopeIds): RawBuilder<string | null> => sql`(
  select o.id from graphs o
  where o.key = g.key and ${visible('o', s)} and ${rankOf('o')} > ${rankOf('g')}
  order by ${rankOf('o')} limit 1
)`;

const isStale = sql<boolean>`g.organization_id is not null and exists (
  select 1 from graphs sg
  join lateral (
    select sv.contract from graph_versions sv
    where sv.graph_id = sg.id and sv.published_at is not null
    order by sv.version desc limit 1
  ) base on true
  where sg.key = g.key and sg.organization_id is null
    and not exists (
      select 1 from graph_versions mv
      where mv.graph_id = g.id and mv.published_at is not null and mv.contract = base.contract
    )
)`;

const toSummary = (r: GraphRow): GraphSummary => ({
  id: r.id,
  key: r.key,
  name: r.name,
  kind: r.kind,
  role: r.role,
  description: r.description,
  scope: r.scope,
  isSystem: r.scope === 'system',
  overrides: r.overrides,
  overriddenBy: r.overridden_by,
  isStale: r.is_stale,
  publishedVersion: r.published,
  draftVersion: r.draft,
  updatedAt: r.updated_at
});

export const searchGraphs = async (
  db: Db,
  s: ScopeIds,
  f: GraphFilters
): Promise<Page<GraphSummary>> => {
  let q = db
    .selectFrom('graphs as g')
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
      'g.role',
      'g.description',
      scopeOf('g').as('scope'),
      'g.updated_at',
      'v.published',
      'v.draft',
      overriddenBy(s).as('overridden_by'),
      overridesOf(s).as('overrides'),
      isStale.as('is_stale')
    ])
    .where(visible('g', s));
  if (f.show === 'workflows') q = q.where('g.kind', '=', 'workflow');
  if (f.show === 'blocks') q = q.where('g.kind', '!=', 'workflow');
  if (f.show === 'mine') q = q.where('g.organization_id', 'is not', null);
  if (f.show === 'customized') {
    q = q.where((eb) =>
      eb.or([eb(overriddenBy(s), 'is not', null), eb(overridesOf(s), 'is not', null)])
    );
  }
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where((eb) =>
      eb.or([eb(sql`lower(g.name)`, 'like', like), eb(sql`lower(g.key)`, 'like', like)])
    );
  }
  const page = await paged(q, f, GRAPH_ORDER, sql.ref('g.id'));
  return { ...page, items: page.items.map((r) => toSummary(r as GraphRow)) };
};

export const findGraph = (db: Db, s: ScopeIds, id: string) =>
  db
    .selectFrom('graphs as g')
    .select([
      'g.id',
      'g.organization_id',
      'g.agency_id',
      'g.key',
      'g.name',
      'g.kind',
      'g.role',
      'g.description',
      scopeOf('g').as('scope'),
      overriddenBy(s).as('overridden_by'),
      overridesOf(s).as('overrides'),
      isStale.as('is_stale')
    ])
    .where('g.id', '=', id)
    .where(visible('g', s))
    .executeTakeFirst();

export const findEffectiveGraph = (db: Db, s: ScopeIds, key: string) =>
  db
    .selectFrom('graphs as g')
    .select(['g.id', scopeOf('g').as('scope')])
    .where('g.key', '=', key)
    .where(visible('g', s))
    .orderBy(rankOf('g'))
    .limit(1)
    .executeTakeFirst();

export const listVersions = (db: Db, graphId: string) =>
  db
    .selectFrom('graph_versions as v')
    .leftJoin('graph_versions as b', 'b.id', 'v.base_version_id')
    .leftJoin('graphs as bg', 'bg.id', 'b.graph_id')
    .select([
      'v.id',
      'v.version',
      'v.published_at',
      'v.created_at',
      'v.updated_at',
      'b.version as base_version',
      'bg.id as base_graph_id'
    ])
    .where('v.graph_id', '=', graphId)
    .orderBy('v.version', 'desc')
    .execute();

export const findVersion = (db: Db, graphId: string, version: number) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version', 'definition', 'published_at', 'base_version_id'])
    .where('graph_id', '=', graphId)
    .where('version', '=', version)
    .executeTakeFirst();

export const findVersionById = (db: Db, id: string) =>
  db
    .selectFrom('graph_versions as v')
    .innerJoin('graphs as g', 'g.id', 'v.graph_id')
    .select(['v.id', 'v.version', 'v.definition', 'g.id as graph_id', scopeOf('g').as('scope')])
    .where('v.id', '=', id)
    .executeTakeFirst();

export const findDraft = (db: Db, graphId: string) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version', 'definition', 'base_version_id'])
    .where('graph_id', '=', graphId)
    .where('published_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

export const insertGraph = (
  db: Db,
  input: {
    organizationId: string;
    agencyId: string | null;
    key: string;
    name: string;
    kind: GraphKind;
    role: GraphRole;
    description: string;
  }
) =>
  db
    .insertInto('graphs')
    .values({
      organization_id: input.organizationId,
      agency_id: input.agencyId,
      key: input.key,
      name: input.name,
      kind: input.kind,
      role: input.role,
      description: input.description
    })
    .returning('id')
    .executeTakeFirstOrThrow();

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
  input: {
    graphId: string;
    version: number;
    definition: GraphDef;
    baseVersionId: string | null;
    userId: string;
  }
) =>
  db
    .insertInto('graph_versions')
    .values({
      graph_id: input.graphId,
      version: input.version,
      definition: JSON.stringify(input.definition),
      contract: contractOf(input.definition.signature),
      base_version_id: input.baseVersionId,
      created_by: input.userId
    })
    .returning(['id', 'version'])
    .executeTakeFirstOrThrow();

export const updateDraft = (
  db: Db,
  id: string,
  definition: GraphDef,
  baseVersionId?: string | null
) =>
  db
    .updateTable('graph_versions')
    .set({
      definition: JSON.stringify(definition),
      contract: contractOf(definition.signature),
      ...(baseVersionId === undefined ? {} : { base_version_id: baseVersionId }),
      updated_at: sql`now()`
    })
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

export const listPublishedNodes = (db: Db, s: ScopeIds) =>
  db
    .selectFrom('graph_versions as gv')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .select([
      'g.id as graph_id',
      'g.key',
      'g.name',
      'g.kind',
      'g.role',
      'g.description',
      'gv.version',
      sql<GraphDef['signature']>`gv.definition -> 'signature'`.as('signature'),
      sql<boolean>`${overriddenBy(s)} is not null`.as('overridden')
    ])
    .where('gv.published_at', 'is not', null)
    .where(visible('g', s))
    .where((eb) =>
      eb.or([
        eb('g.organization_id', 'is', null),
        eb.not(
          eb.exists(
            eb
              .selectFrom('graphs as b')
              .select('b.id')
              .whereRef('b.key', '=', 'g.key')
              .where(sql<boolean>`${rankOf('b')} > ${rankOf('g')}`)
              .where(visible('b', s))
          )
        )
      ])
    )
    .orderBy('g.key')
    .orderBy('gv.version', 'desc')
    .execute();

export const findSystemGraph = (db: Db, key: string) =>
  db
    .selectFrom('graphs')
    .select('id')
    .where('key', '=', key)
    .where('organization_id', 'is', null)
    .executeTakeFirst();

export const findNewestPublishedVersion = (db: Db, graphId: string) =>
  db
    .selectFrom('graph_versions')
    .select(['id', 'version', 'definition', 'contract'])
    .where('graph_id', '=', graphId)
    .where('published_at', 'is not', null)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();

export const findScopedGraph = (
  db: Db,
  scope: { organizationId: string; agencyId: string | null },
  key: string
) =>
  db
    .selectFrom('graphs')
    .select(['id', 'is_active'])
    .where('organization_id', '=', scope.organizationId)
    .where('agency_id', scope.agencyId === null ? 'is' : '=', scope.agencyId)
    .where('key', '=', key)
    .executeTakeFirst();

export const setGraphActive = (db: Db, id: string, active: boolean) =>
  db
    .updateTable('graphs')
    .set({ is_active: active, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('organization_id', 'is not', null)
    .returning('id')
    .executeTakeFirst();

export const deleteGraph = (db: Db, id: string) =>
  db
    .deleteFrom('graphs')
    .where('id', '=', id)
    .where('organization_id', 'is not', null)
    .returning('id')
    .executeTakeFirst();
