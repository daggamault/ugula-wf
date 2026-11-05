import { type Db, type GraphRole, resolvedGraph, resolvedTable } from '@ugula/db';
import { type RawBuilder, sql } from 'kysely';
import { type AgencyAccess, hasPermission } from './access.ts';

export type Scope = 'system' | 'organization' | 'agency';

export type EditScope = Exclude<Scope, 'system'>;

export type ScopeIds = { agencyId: string; organizationId: string };

export type Owner = { organizationId: string; agencyId: string | null };

export type ScopedTable = 'graphs' | 'data_tables';

const VERSIONS = {
  graphs: { table: 'graph_versions', owner: 'graph_id' },
  data_tables: { table: 'data_table_versions', owner: 'table_id' }
} as const;

export const RANK: Readonly<Record<Scope, number>> = { agency: 0, organization: 1, system: 2 };

export const scopeOf = (alias: string) =>
  sql<Scope>`case when ${sql.ref(`${alias}.agency_id`)} is not null then 'agency'
    when ${sql.ref(`${alias}.organization_id`)} is not null then 'organization'
    else 'system' end`;

export const rankOf = (alias: string) =>
  sql<number>`case when ${sql.ref(`${alias}.agency_id`)} is not null then 0
    when ${sql.ref(`${alias}.organization_id`)} is not null then 1 else 2 end`;

export const visible = (alias: string, s: Owner) => {
  const a = (c: string) => sql.ref(`${alias}.${c}`);
  return sql<boolean>`(
    ${a('organization_id')} is null
    or (${a('is_active')} and ${a('agency_id')} = ${s.agencyId}::uuid)
    or (${a('is_active')} and ${a('agency_id')} is null and ${a('organization_id')} = ${s.organizationId}::uuid)
  )`;
};

const resolvedIn = (table: ScopedTable, agencyId: string, key: RawBuilder<unknown>) =>
  table === 'graphs' ? resolvedGraph(agencyId, key) : resolvedTable(agencyId, key);

export const effectiveIdOf = (
  table: ScopedTable,
  key: RawBuilder<unknown>,
  s: ScopeIds
): RawBuilder<string | null> => {
  const v = VERSIONS[table];
  return sql`(
    select (
      select ev.${sql.ref(v.owner)} from ${sql.table(v.table)} ev
      where ev.id = ${resolvedIn(table, s.agencyId, sql.ref('ek.key'))}
    )
    from (select ${key} as key) ek
  )`;
};

export const overriddenByIn = (
  table: ScopedTable,
  alias: string,
  s: ScopeIds
): RawBuilder<string | null> => sql`(
  select o.id from ${sql.table(table)} o
  where o.id = ${effectiveIdOf(table, sql.ref(`${alias}.key`), s)}
    and ${rankOf('o')} < ${rankOf(alias)}
)`;

export const overridesIn = (
  table: ScopedTable,
  alias: string,
  s: ScopeIds
): RawBuilder<string | null> => sql`(
  select o.id from ${sql.table(table)} o
  where o.key = ${sql.ref(`${alias}.key`)} and ${visible('o', s)}
    and ${rankOf('o')} > ${rankOf(alias)}
  order by ${rankOf('o')} limit 1
)`;

export const isStaleIn = (table: ScopedTable, alias: string) => {
  const v = VERSIONS[table];
  const owner = sql.ref(v.owner);
  return sql<boolean>`${sql.ref(`${alias}.organization_id`)} is not null and exists (
    select 1 from ${sql.table(table)} sg
    join lateral (
      select sv.contract from ${sql.table(v.table)} sv
      where sv.${owner} = sg.id and sv.published_at is not null
      order by sv.version desc limit 1
    ) base on true
    where sg.key = ${sql.ref(`${alias}.key`)} and sg.organization_id is null
      and not exists (
        select 1 from ${sql.table(v.table)} mv
        where mv.${owner} = ${sql.ref(`${alias}.id`)} and mv.published_at is not null
          and mv.contract = base.contract
      )
  )`;
};

export type EditTier = GraphRole | 'table';

const MANAGED: ReadonlySet<EditTier> = new Set(['workflow', 'stage']);

export const canEditScope = (access: AgencyAccess, scope: Scope, tier: EditTier) =>
  scope === 'system'
    ? false
    : scope === 'organization'
      ? access.isOrganizationAdmin
      : hasPermission(access, MANAGED.has(tier) ? 'workflows:manage' : 'workflows:update');

export const scopeIds = (access: AgencyAccess): ScopeIds => ({
  agencyId: access.agencyId,
  organizationId: access.organizationId
});

export const ownerOf = (access: AgencyAccess, scope: EditScope): Owner => ({
  organizationId: access.organizationId,
  agencyId: scope === 'agency' ? access.agencyId : null
});

export type Effective = { id: string; key: string; name: string; scope: Scope };

export const buildEffective = (table: ScopedTable, s: ScopeIds) => sql<Effective>`
  select e.id, e.key, e.name, ${scopeOf('e')} as scope
  from (select distinct k.key from ${sql.table(table)} k where ${visible('k', s)}) keys
  join ${sql.table(table)} e on e.id = ${effectiveIdOf(table, sql.ref('keys.key'), s)}
  order by e.key`;

const ALIAS = { graphs: 'g', data_tables: 't' } as const;

export const findEffectiveIn = (db: Db, table: ScopedTable, s: ScopeIds, key: string) => {
  const a = ALIAS[table];
  return db
    .selectFrom(sql.table(table).as(a))
    .select([sql.ref<string>(`${a}.id`).as('id'), scopeOf(a).as('scope')])
    .where(sql.ref(`${a}.id`), '=', effectiveIdOf(table, sql`${key}::text`, s))
    .executeTakeFirst();
};

export const listEffective = async (db: Db, table: ScopedTable, s: ScopeIds) =>
  (await buildEffective(table, s).execute(db)).rows;

export const findScoped = (db: Db, table: ScopedTable, owner: Owner, key: string) =>
  db
    .selectFrom(table)
    .select(['id', 'is_active'])
    .where('organization_id', '=', owner.organizationId)
    .where('agency_id', owner.agencyId === null ? 'is' : '=', owner.agencyId)
    .where('key', '=', key)
    .executeTakeFirst();

export const findSystem = (db: Db, table: ScopedTable, key: string) =>
  db
    .selectFrom(table)
    .select('id')
    .where('key', '=', key)
    .where('organization_id', 'is', null)
    .executeTakeFirst();

export const setActive = (db: Db, table: ScopedTable, id: string, active: boolean) =>
  db
    .updateTable(table)
    .set({ is_active: active, updated_at: sql`now()` })
    .where('id', '=', id)
    .where('organization_id', 'is not', null)
    .returning('id')
    .executeTakeFirst();

export const touch = async (db: Db, table: ScopedTable, id: string) => {
  await db.updateTable(table).set({ updated_at: sql`now()` }).where('id', '=', id).execute();
};

export const lockOwner = async (db: Db, table: ScopedTable, id: string) => {
  await db.selectFrom(table).select('id').where('id', '=', id).forUpdate().execute();
};

export const findNewestPublished = (db: Db, table: ScopedTable, ownerId: string) =>
  db
    .selectFrom(VERSIONS[table].table)
    .select(['id', 'version', 'definition', 'contract'])
    .where(VERSIONS[table].owner, '=', ownerId)
    .where('published_at', 'is not', null)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();

export const findDraftOf = (db: Db, table: ScopedTable, ownerId: string) =>
  db
    .selectFrom(VERSIONS[table].table)
    .select(['id', 'version', 'definition', 'base_version_id'])
    .where(VERSIONS[table].owner, '=', ownerId)
    .where('published_at', 'is', null)
    .forUpdate()
    .executeTakeFirst();

export const nextVersionOf = async (db: Db, table: ScopedTable, ownerId: string) =>
  ((
    await db
      .selectFrom(VERSIONS[table].table)
      .select((eb) => eb.fn.max('version').as('max'))
      .where(VERSIONS[table].owner, '=', ownerId)
      .executeTakeFirst()
  )?.max ?? 0) + 1;

export const findVersionOf = (db: Db, table: ScopedTable, ownerId: string, version: number) =>
  db
    .selectFrom(VERSIONS[table].table)
    .select(['id', 'version', 'definition', 'published_at', 'base_version_id'])
    .where(VERSIONS[table].owner, '=', ownerId)
    .where('version', '=', version)
    .executeTakeFirst();

export const findHeadVersion = (db: Db, table: ScopedTable, ownerId: string) =>
  db
    .selectFrom(VERSIONS[table].table)
    .select(['id', 'version', 'definition', 'base_version_id'])
    .where(VERSIONS[table].owner, '=', ownerId)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirst();

type VersionOf = {
  id: string;
  version: number;
  definition: unknown;
  owner_id: string;
  scope: Scope;
};

export const findVersionById = async (db: Db, table: ScopedTable, id: string) => {
  const v = VERSIONS[table];
  return (
    await sql<VersionOf>`
      select v.id, v.version, v.definition, o.id as owner_id, ${scopeOf('o')} as scope
      from ${sql.table(v.table)} v
      join ${sql.table(table)} o on o.id = v.${sql.ref(v.owner)}
      where v.id = ${id}::uuid`.execute(db)
  ).rows[0];
};
