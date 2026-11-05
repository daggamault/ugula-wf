import { localDate } from '@ugula/billing';
import { type RawBuilder, sql } from 'kysely';
import type { Db } from './schema.ts';

const idOf = (agencyId: RawBuilder<unknown> | string) =>
  typeof agencyId === 'string' ? sql`${agencyId}::uuid` : agencyId;

export const agencyTimeZone = (agencyId: RawBuilder<unknown> | string) =>
  sql<string>`coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = ${idOf(agencyId)}), 'UTC')`;

export const findTimeZone = async (db: Db, agencyId: string) =>
  (await sql<{ zone: string }>`select ${agencyTimeZone(agencyId)} as zone`.execute(db)).rows[0]
    ?.zone ?? 'UTC';

export const agencyToday = async (db: Db, agencyId: string, at: Date) =>
  localDate(at, await findTimeZone(db, agencyId));
