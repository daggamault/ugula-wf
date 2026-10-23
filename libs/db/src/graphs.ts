import { type Kysely, sql } from 'kysely';
import type { Database } from './index.ts';

export type GraphKey = {
  key: string;
  version: number;
};

export type PublishedGraph = GraphKey & {
  id: string;
  definition: unknown;
};

export const buildFindPublishedGraphs = (
  db: Kysely<Database>,
  tenantId: string | null,
  refs: GraphKey[]
) =>
  db
    .selectFrom('graph_versions as gv')
    .innerJoin('graphs as g', 'g.id', 'gv.graph_id')
    .distinctOn(['g.key', 'gv.version'])
    .select(['gv.id', 'g.key', 'gv.version', 'gv.definition'])
    .where('gv.published_at', 'is not', null)
    .where((eb) =>
      tenantId
        ? eb.or([eb('g.tenant_id', '=', tenantId), eb('g.tenant_id', 'is', null)])
        : eb('g.tenant_id', 'is', null)
    )
    .where((eb) =>
      eb.or(refs.map((r) => eb.and([eb('g.key', '=', r.key), eb('gv.version', '=', r.version)])))
    )
    .orderBy('g.key')
    .orderBy('gv.version')
    .orderBy(sql`g.tenant_id nulls last`);

export const findPublishedGraphs = async (
  db: Kysely<Database>,
  tenantId: string | null,
  refs: GraphKey[]
): Promise<PublishedGraph[]> =>
  refs.length ? buildFindPublishedGraphs(db, tenantId, refs).execute() : [];

export const buildFindGraphBundle = (versionId: string) => sql<PublishedGraph>`
  with recursive bundle (id) as (
    select ${versionId}::uuid
    union
    select dep from bundle
    join graph_versions gv on gv.id = bundle.id
    cross join unnest(gv.dependencies) as dep
  )
  select gv.id, g.key, gv.version, gv.definition
  from bundle
  join graph_versions gv on gv.id = bundle.id
  join graphs g on g.id = gv.graph_id`;

export const findGraphBundle = async (db: Kysely<Database>, versionId: string) =>
  (await buildFindGraphBundle(versionId).execute(db)).rows;
