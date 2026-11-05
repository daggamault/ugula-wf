import { type Kysely, type RawBuilder, sql } from 'kysely';
import type { Database, TableKind } from './schema.ts';

export const TABLE_PUBLISHED_IMMUTABLE_TRIGGER = 'data_table_versions_published_immutable';

export type RunTableRef = { key: string; id: string };

const organizationOf = (agencyId: string) =>
  sql`(select a.organization_id from agencies a where a.id = ${agencyId}::uuid)`;

export const resolvedTable = (agencyId: string, key: RawBuilder<unknown>) =>
  sql<{ id: string }>`(
    select v.id
    from data_tables t
    join data_table_versions v on v.table_id = t.id
    left join lateral (
      select sv.contract
      from data_tables st
      join data_table_versions sv on sv.table_id = st.id
      where st.key = t.key and st.organization_id is null and sv.published_at is not null
      order by sv.version desc
      limit 1
    ) base on true
    where t.key = ${key}
      and t.is_active
      and v.published_at is not null
      and (
        t.organization_id is null
        or (
          (
            t.agency_id = ${agencyId}::uuid
            or (t.agency_id is null and t.organization_id = ${organizationOf(agencyId)})
          )
          and (base.contract is null or v.contract = base.contract)
        )
      )
    order by t.agency_id is null, t.organization_id is null, v.version desc
    limit 1
  )`;

const TABLE_KEYS_PATH =
  '$.nodes[*] ? (@.type == "std.table.decide" || @.type == "std.table.lookup").config.table.key';

export const buildPinRunTables = (runId: string, agencyId: string, parentRunId: string | null) => {
  const pinned = parentRunId
    ? sql`coalesce(
        (
          select p.table_version_id from workflow_run_tables p
          where p.run_id = ${parentRunId}::uuid and p.key = k.key
        ),
        ${resolvedTable(agencyId, sql.ref('k.key'))}
      )`
    : resolvedTable(agencyId, sql.ref('k.key'));
  return sql`
    insert into workflow_run_tables (run_id, key, table_version_id)
    select ${runId}::uuid, k.key, r.id
    from (
      select distinct jsonb_path_query(gv.definition, ${TABLE_KEYS_PATH}::jsonpath) #>> '{}' as key
      from workflow_run_graphs g
      join graph_versions gv on gv.id = g.graph_version_id
      where g.run_id = ${runId}::uuid
    ) k
    cross join lateral (select ${pinned} as id) r
    where r.id is not null
    on conflict do nothing`;
};

export const buildCopyRunTables = (fromRunId: string, toRunIds: string[]) => sql`
  insert into workflow_run_tables (run_id, key, table_version_id)
  select t.id, p.key, p.table_version_id
  from workflow_run_tables p
  cross join unnest(${toRunIds}::uuid[]) as t (id)
  where p.run_id = ${fromRunId}::uuid
  on conflict do nothing`;

export const findTableDefinitions = async (
  db: Kysely<Database>,
  ids: string[]
): Promise<{ id: string; kind: TableKind; definition: unknown }[]> =>
  ids.length
    ? db
        .selectFrom('data_table_versions as v')
        .innerJoin('data_tables as t', 't.id', 'v.table_id')
        .select(['v.id', 't.kind', 'v.definition'])
        .where('v.id', 'in', [...new Set(ids)])
        .execute()
    : [];

export const buildFindGraphTables = (agencyId: string, versionIds: string[]) => sql<{
  key: string;
  kind: TableKind;
  definition: unknown;
}>`
  select k.key, t.kind, tv.definition
  from (
    select distinct jsonb_path_query(gv.definition, ${TABLE_KEYS_PATH}::jsonpath) #>> '{}' as key
    from graph_versions gv
    where gv.id = any(${versionIds}::uuid[])
  ) k
  cross join lateral (select ${resolvedTable(agencyId, sql.ref('k.key'))} as id) r
  join data_table_versions tv on tv.id = r.id
  join data_tables t on t.id = tv.table_id
  order by k.key`;

export const findGraphTables = async (
  db: Kysely<Database>,
  agencyId: string,
  versionIds: string[]
) => (versionIds.length ? (await buildFindGraphTables(agencyId, versionIds).execute(db)).rows : []);
