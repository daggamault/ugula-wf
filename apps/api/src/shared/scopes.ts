import type { GraphRole } from '@ugula/db';
import { type RawBuilder, sql } from 'kysely';
import { type AgencyAccess, hasPermission } from './access.ts';

export type Scope = 'system' | 'organization' | 'agency';

export type EditScope = Exclude<Scope, 'system'>;

export type ScopeIds = { agencyId: string; organizationId: string };

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

export const visible = (alias: string, s: ScopeIds) => {
  const a = (c: string) => sql.ref(`${alias}.${c}`);
  return sql<boolean>`(
    ${a('organization_id')} is null
    or (${a('is_active')} and ${a('agency_id')} = ${s.agencyId}::uuid)
    or (${a('is_active')} and ${a('agency_id')} is null and ${a('organization_id')} = ${s.organizationId}::uuid)
  )`;
};

const neighbour = (
  table: ScopedTable,
  alias: string,
  s: ScopeIds,
  side: '<' | '>'
): RawBuilder<string | null> => sql`(
  select o.id from ${sql.table(table)} o
  where o.key = ${sql.ref(`${alias}.key`)} and ${visible('o', s)}
    and ${rankOf('o')} ${sql.raw(side)} ${rankOf(alias)}
  order by ${rankOf('o')} limit 1
)`;

export const overriddenByIn = (table: ScopedTable, alias: string, s: ScopeIds) =>
  neighbour(table, alias, s, '<');

export const overridesIn = (table: ScopedTable, alias: string, s: ScopeIds) =>
  neighbour(table, alias, s, '>');

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

export const ownerOf = (access: AgencyAccess, scope: EditScope) => ({
  organizationId: access.organizationId,
  agencyId: scope === 'agency' ? access.agencyId : null
});
