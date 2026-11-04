import { type Kysely, type RawBuilder, sql } from 'kysely';
import type { Database } from './schema.ts';

type GraphKey = {
  key: string;
  version: number;
};

export type GraphRef = GraphKey & { id: string };

export type PublishedGraph = GraphRef & { definition: unknown };

export const PUBLISHED_IMMUTABLE_TRIGGER = 'graph_versions_published_immutable';

export const dependencyOf = (ref: GraphKey) => `${ref.key}@${ref.version}`;

const organizationOf = (agencyId: string | null) =>
  sql`(select a.organization_id from agencies a where a.id = ${agencyId}::uuid)`;

const resolved = (
  agencyId: string | null,
  key: RawBuilder<unknown>,
  version: RawBuilder<unknown>
) =>
  sql<{ id: string }>`(
    select v.id
    from graphs g
    join graph_versions v on v.graph_id = g.id
    left join lateral (
      select sv.contract
      from graphs sg
      join graph_versions sv on sv.graph_id = sg.id
      where sg.key = g.key and sg.organization_id is null
        and sv.version = ${version} and sv.published_at is not null
    ) base on true
    where g.key = ${key}
      and g.is_active
      and v.published_at is not null
      and (
        (g.organization_id is null and v.version = ${version})
        or (
          (
            g.agency_id = ${agencyId}::uuid
            or (g.agency_id is null and g.organization_id = ${organizationOf(agencyId)})
          )
          and case when base.contract is null then v.version = ${version}
            else v.contract = base.contract end
        )
      )
    order by g.agency_id is null, g.organization_id is null, v.version desc
    limit 1
  )`;

const pinnedOr = (
  parentRunId: string | null,
  agencyId: string | null,
  key: RawBuilder<unknown>,
  version: RawBuilder<unknown>
) =>
  parentRunId
    ? sql<{ id: string }>`(
        select coalesce(
          (
            select p.graph_version_id from workflow_run_graphs p
            where p.run_id = ${parentRunId}::uuid and p.key = ${key} and p.version = ${version}
          ),
          ${resolved(agencyId, key, version)}
        ) as id
      )`
    : resolved(agencyId, key, version);

export const buildFindPublishedGraphs = (
  agencyId: string | null,
  refs: GraphKey[],
  parentRunId: string | null = null
) => sql<PublishedGraph>`
  select r.id, req.key, req.version, gv.definition
  from unnest(${refs.map((r) => r.key)}::text[], ${refs.map((r) => r.version)}::int[])
    as req (key, version)
  cross join lateral ${pinnedOr(parentRunId, agencyId, sql.ref('req.key'), sql.ref('req.version'))} r
  join graph_versions gv on gv.id = r.id
  order by req.key, req.version`;

export const findPublishedGraphs = async (
  db: Kysely<Database>,
  agencyId: string | null,
  refs: GraphKey[],
  parentRunId: string | null = null
): Promise<PublishedGraph[]> =>
  refs.length ? (await buildFindPublishedGraphs(agencyId, refs, parentRunId).execute(db)).rows : [];

const bundle = (agencyId: string, versionId: string, parentRunId: string | null) => sql`
  with recursive bundle (id, key, version) as (
    select gv.id, g.key, gv.version
    from graph_versions gv
    join graphs g on g.id = gv.graph_id
    where gv.id = ${versionId}::uuid
    union
    select r.id, dep.key, dep.version
    from bundle b
    join graph_versions gv on gv.id = b.id
    cross join lateral (
      select split_part(d, '@', 1) as key, split_part(d, '@', 2)::int as version
      from unnest(gv.dependencies) as d
    ) dep
    cross join lateral ${pinnedOr(parentRunId, agencyId, sql.ref('dep.key'), sql.ref('dep.version'))} r
    where r.id is not null
  )`;

export const buildPinRunGraphs = (
  runId: string,
  agencyId: string,
  versionId: string,
  parentRunId: string | null = null
) => sql`
  insert into workflow_run_graphs (run_id, key, version, graph_version_id)
  ${bundle(agencyId, versionId, parentRunId)}
  select ${runId}::uuid, key, version, id from bundle
  on conflict do nothing`;

type PinRun = { agencyId: string; versionId: string; parentRunId?: string | null };

export const pinRunGraphs = async (db: Kysely<Database>, run: PinRun & { id: string }) => {
  await buildPinRunGraphs(run.id, run.agencyId, run.versionId, run.parentRunId ?? null).execute(db);
};

const listRunGraphRefs = (db: Kysely<Database>, runId: string): Promise<GraphRef[]> =>
  db
    .selectFrom('workflow_run_graphs')
    .select(['graph_version_id as id', 'key', 'version'])
    .where('run_id', '=', runId)
    .orderBy('key')
    .orderBy('version')
    .execute();

export const findDefinitions = async (db: Kysely<Database>, ids: string[]) =>
  ids.length
    ? db
        .selectFrom('graph_versions')
        .select(['id', 'definition'])
        .where('id', 'in', [...new Set(ids)])
        .execute()
    : [];

const withDefinitions = async (
  db: Kysely<Database>,
  refs: GraphRef[]
): Promise<PublishedGraph[]> => {
  const defs = new Map(
    (
      await findDefinitions(
        db,
        refs.map((r) => r.id)
      )
    ).map((d) => [d.id, d.definition])
  );
  return refs.map((r) => ({ ...r, definition: defs.get(r.id) ?? null }));
};

export const findRunGraphs = async (
  db: Kysely<Database>,
  runId: string
): Promise<PublishedGraph[]> => withDefinitions(db, await listRunGraphRefs(db, runId));

const buildCopyRunGraphs = (fromRunId: string, toRunIds: string[]) => sql`
  insert into workflow_run_graphs (run_id, key, version, graph_version_id)
  select t.id, g.key, g.version, g.graph_version_id
  from workflow_run_graphs g
  cross join unnest(${toRunIds}::uuid[]) as t (id)
  where g.run_id = ${fromRunId}::uuid
  on conflict do nothing`;

export const pinRunsGraphs = async (db: Kysely<Database>, runs: PinRun & { ids: string[] }) => {
  const [first, ...rest] = runs.ids;
  if (!first) return;
  await pinRunGraphs(db, { ...runs, id: first });
  if (rest.length) await buildCopyRunGraphs(first, rest).execute(db);
};

export const buildLatestVersion = (agencyId: string, key: string) => sql<{ version: number }>`
  select v.version
  from graphs g
  join graph_versions v on v.graph_id = g.id
  where g.key = ${key}
    and g.kind = 'workflow'
    and g.is_active
    and v.published_at is not null
    and (
      g.organization_id is null
      or g.agency_id = ${agencyId}::uuid
      or (g.agency_id is null and g.organization_id = ${organizationOf(agencyId)})
    )
  order by g.organization_id is not null, v.version desc
  limit 1`;
