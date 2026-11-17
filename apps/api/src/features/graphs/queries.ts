import { type Db, type GraphKind, type GraphRole, resolvedGraph } from '@ugula/db';
import { contractOf, type GraphDef } from '@ugula/graph';
import { sql } from 'kysely';
import { type FacetedPage, facetCounts, whereFacets } from '../../shared/facets.ts';
import { type PageRequest, paged } from '../../shared/paging.ts';
import {
  isStaleIn,
  overriddenByIn,
  overridesIn,
  rankOf,
  type Scope,
  type ScopeIds,
  scopeOf,
  visible
} from '../../shared/scopes.ts';
import { containsPattern } from '../../shared/search.ts';
import type { GraphSort } from './schemas.ts';

type GraphSummary = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  description: string;
  scope: Scope;
  isSystem: boolean;
  overrides: string | null;
  overriddenBy: string | null;
  isStale: boolean;
  publishedVersion: number | null;
  draftVersion: number | null;
  trigger: unknown;
  updatedAt: Date;
};

export type GraphFilters = PageRequest<GraphSort> & {
  q?: string | undefined;
  kind: readonly GraphKind[];
  scope: readonly Scope[];
};

type GraphRow = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  description: string;
  scope: Scope;
  updated_at: Date;
  published: number | null;
  draft: number | null;
  overridden_by: string | null;
  overrides: string | null;
  is_stale: boolean;
  trigger: unknown;
};

const GRAPH_ORDER = {
  name: sql`lower(g.name)`,
  kind: sql`(g.kind, lower(g.name))`,
  updated: sql.ref('g.updated_at')
};

const GRAPH_FACETS = {
  kind: { value: sql.ref('g.kind') },
  scope: { value: scopeOf('g') }
};

type GraphFacet = keyof typeof GRAPH_FACETS;

const overriddenBy = (s: ScopeIds) => overriddenByIn('graphs', 'g', s);

const overridesOf = (s: ScopeIds) => overridesIn('graphs', 'g', s);

const isStale = isStaleIn('graphs', 'g');

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
  trigger: r.trigger,
  updatedAt: r.updated_at
});

const filteredGraphs = (db: Db, s: ScopeIds, f: GraphFilters, except?: GraphFacet) => {
  let q = db.selectFrom('graphs as g').where(visible('g', s));
  if (f.q) {
    const like = containsPattern(f.q);
    q = q.where(sql`lower(g.name)`, 'like', like);
  }
  return whereFacets(q, GRAPH_FACETS, f, except);
};

export const searchGraphs = async (
  db: Db,
  s: ScopeIds,
  f: GraphFilters
): Promise<FacetedPage<GraphSummary, GraphFacet>> => {
  const q = filteredGraphs(db, s, f)
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('graph_versions as gv')
          .select([
            sql<number | null>`max(gv.version) filter (where gv.published_at is not null)`.as(
              'published'
            ),
            sql<number | null>`max(gv.version) filter (where gv.published_at is null)`.as('draft'),
            sql<unknown>`(array_agg(gv.trigger order by gv.version desc))[1]`.as('trigger')
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
      'v.trigger',
      overriddenBy(s).as('overridden_by'),
      overridesOf(s).as('overrides'),
      isStale.as('is_stale')
    ]);
  const [page, facets] = await Promise.all([
    paged(q, f, GRAPH_ORDER, sql.ref('g.id')),
    facetCounts((except) => filteredGraphs(db, s, f, except), GRAPH_FACETS)
  ]);
  return { ...page, items: page.items.map((r) => toSummary(r as GraphRow)), facets };
};

export const findGraph = (db: Db, s: ScopeIds, id: string) =>
  db
    .selectFrom('graphs as g')
    .select([
      'g.id',
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

export const insertGraph = (
  db: Db,
  input: {
    agencyId: string;
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
      agency_id: input.agencyId,
      key: input.key,
      name: input.name,
      kind: input.kind,
      role: input.role,
      description: input.description
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const updateGraphDetails = (
  db: Db,
  graphId: string,
  details: { name: string; description: string }
) =>
  db
    .updateTable('graphs')
    .set({ name: details.name, description: details.description, updated_at: sql`now()` })
    .where('id', '=', graphId)
    .execute();

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
      created_by_id: input.userId
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
        eb('g.agency_id', 'is', null),
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

export const deleteGraph = (db: Db, id: string) =>
  db
    .deleteFrom('graphs')
    .where('id', '=', id)
    .where('agency_id', 'is not', null)
    .returning('id')
    .executeTakeFirst();

export const listDependents = async (db: Db, s: ScopeIds, key: string, graphId: string) =>
  (
    await sql<{ name: string }>`
      select distinct g.name
      from graphs g
      join lateral (
        select v.dependencies from graph_versions v
        where v.graph_id = g.id and v.published_at is not null
        order by v.version desc
        limit 1
      ) newest on true
      where g.id <> ${graphId}::uuid
        and g.is_active
        and g.agency_id = ${s.agencyId}::uuid
        and exists (
          select 1 from unnest(newest.dependencies) d where split_part(d, '@', 1) = ${key}
        )
      order by g.name`.execute(db)
  ).rows;

export const findVisibleTableKinds = async (db: Db, s: ScopeIds, keys: string[]) =>
  keys.length
    ? await db
        .selectFrom('data_tables as t')
        .select(['t.key', 't.kind'])
        .distinct()
        .where('t.key', 'in', keys)
        .where(visible('t', s))
        .execute()
    : [];

type EffectiveGraph = {
  id: string;
  key: string;
  name: string;
  kind: GraphKind;
  role: GraphRole;
  scope: Scope;
  definition: GraphDef;
};

const buildEffectiveGraphs = (s: ScopeIds) => sql<EffectiveGraph>`
  select g.id, g.key, g.name, g.kind, g.role, ${scopeOf('g')} as scope, v.definition
  from (select distinct k.key from graphs k where ${visible('k', s)}) keys
  cross join lateral (select ${resolvedGraph(s.agencyId, sql.ref('keys.key'))} as id) r
  join graph_versions v on v.id = r.id
  join graphs g on g.id = v.graph_id
  order by g.key`;

export const listEffectiveGraphs = async (db: Db, s: ScopeIds) =>
  (await buildEffectiveGraphs(s).execute(db)).rows;
