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

const resolved = (
  tenantId: string | null,
  key: RawBuilder<unknown>,
  version: RawBuilder<unknown>
) =>
  sql<{ id: string }>`(
    select v.id
    from graphs g
    join graph_versions v on v.graph_id = g.id
    where g.key = ${key}
      and v.published_at is not null
      and (
        (g.tenant_id is null and v.version = ${version})
        or (
          g.tenant_id = ${tenantId}::uuid
          and g.is_active
          and (
            v.version = ${version}
            or exists (select 1 from graphs s where s.key = g.key and s.tenant_id is null)
          )
        )
      )
    order by g.tenant_id nulls last, v.version desc
    limit 1
  )`;

export const buildFindPublishedGraphs = (
  tenantId: string | null,
  refs: GraphKey[]
) => sql<PublishedGraph>`
  select r.id, req.key, req.version, gv.definition
  from unnest(${refs.map((r) => r.key)}::text[], ${refs.map((r) => r.version)}::int[])
    as req (key, version)
  cross join lateral ${resolved(tenantId, sql.ref('req.key'), sql.ref('req.version'))} r
  join graph_versions gv on gv.id = r.id
  order by req.key, req.version`;

export const findPublishedGraphs = async (
  db: Kysely<Database>,
  tenantId: string | null,
  refs: GraphKey[]
): Promise<PublishedGraph[]> =>
  refs.length ? (await buildFindPublishedGraphs(tenantId, refs).execute(db)).rows : [];

const bundle = (tenantId: string | null, versionId: string) => sql`
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
    cross join lateral ${resolved(tenantId, sql.ref('dep.key'), sql.ref('dep.version'))} r
  )`;

export const buildPinRunGraphs = (runId: string, tenantId: string, versionId: string) => sql`
  insert into workflow_run_graphs (run_id, key, version, graph_version_id)
  ${bundle(tenantId, versionId)}
  select ${runId}::uuid, key, version, id from bundle
  on conflict do nothing`;

export const pinRunGraphs = async (
  db: Kysely<Database>,
  run: { id: string; tenantId: string; versionId: string }
) => {
  await buildPinRunGraphs(run.id, run.tenantId, run.versionId).execute(db);
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

export const pinRunsGraphs = async (
  db: Kysely<Database>,
  runs: { ids: string[]; tenantId: string; versionId: string }
) => {
  const [first, ...rest] = runs.ids;
  if (!first) return;
  await pinRunGraphs(db, { id: first, tenantId: runs.tenantId, versionId: runs.versionId });
  if (rest.length) await buildCopyRunGraphs(first, rest).execute(db);
};
