import { CLOSED_CLAIM_STATUSES, dailyNumberOf, nameKey } from '@ugula/billing';
import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import { escapeLike } from '../../shared/search.ts';
import type { PatientSort } from './schemas.ts';

export type PatientFilters = PageRequest<PatientSort> & {
  lastName?: string | undefined;
  firstName?: string | undefined;
  birthDate?: string | undefined;
  number?: string | undefined;
};

const patientRows = (db: Db, agencyId: string) =>
  db
    .selectFrom('patients as p')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('claims as c')
          .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
          .select([
            sql<number>`count(*)::int`.as('claim_count'),
            sql<number>`(coalesce(sum(b.balance_cents) filter (where c.status not in (${sql.join(
              CLOSED_CLAIM_STATUSES.map((s) => sql.lit(s))
            )})), 0))::int`.as('balance_cents'),
            sql<string | null>`max(c.service_date)::text`.as('last_service_date')
          ])
          .whereRef('c.patient_id', '=', 'p.id')
          .as('claimed'),
      (join) => join.onTrue()
    )
    .select([
      'p.id',
      'p.number',
      'p.first_name',
      'p.last_name',
      sql<string>`p.birth_date::text`.as('birth_date'),
      'p.gender',
      'p.address_line',
      'p.city',
      'p.state',
      'p.postal_code',
      'claimed.claim_count',
      'claimed.balance_cents',
      'claimed.last_service_date'
    ])
    .where('p.agency_id', '=', agencyId);

const PATIENT_ORDER = {
  name: sql`lower(p.last_name || ' ' || p.first_name)`,
  number: sql.ref('p.number'),
  born: sql.ref('p.birth_date'),
  lastService: sql.ref('claimed.last_service_date'),
  balance: sql.ref('claimed.balance_cents'),
  city: sql`lower(p.city || ' ' || coalesce(p.state, ''))`,
  claims: sql.ref('claimed.claim_count')
};

export const listPatients = (db: Db, agencyId: string, f: PatientFilters) => {
  let q = patientRows(db, agencyId);
  const last = f.lastName ? nameKey(f.lastName) : '';
  if (last) q = q.where('p.last_name_key', 'like', `${escapeLike(last)}%`);
  const first = f.firstName?.trim().toLowerCase();
  if (first) q = q.where(sql`lower(p.first_name)`, 'like', `${escapeLike(first)}%`);
  if (f.birthDate) q = q.where('p.birth_date', '=', f.birthDate);
  if (f.number) q = q.where('p.number', '=', dailyNumberOf(f.number) ?? '');
  return paged(q, f, PATIENT_ORDER, sql.ref('p.id'));
};

export const findPatient = (db: Db, agencyId: string, id: string) =>
  patientRows(db, agencyId).where('p.id', '=', id).executeTakeFirst();
