import { type RawBuilder, sql } from 'kysely';

const idOf = (agencyId: RawBuilder<unknown> | string) =>
  typeof agencyId === 'string' ? sql`${agencyId}::uuid` : agencyId;

export const agencyTimeZone = (agencyId: RawBuilder<unknown> | string) =>
  sql<string>`coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = ${idOf(agencyId)}), 'UTC')`;
