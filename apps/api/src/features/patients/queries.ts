import { nameKey } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import { type PageRequest, paged } from '../../shared/paging.ts';
import type { PatientSort } from './schemas.ts';

type Db = Kysely<Database>;

export type PatientFilters = PageRequest<PatientSort> & {
  lastName?: string | undefined;
  firstName?: string | undefined;
  birthDate?: string | undefined;
};

const escapeLike = (s: string) => s.replace(/[\\%_]/g, '\\$&');

const patientRows = (db: Db, tenantId: string) =>
  db
    .selectFrom('patients as p')
    .leftJoinLateral(
      (eb) =>
        eb
          .selectFrom('claims as c')
          .innerJoin('claim_balances as b', 'b.claim_id', 'c.id')
          .select([
            sql<number>`count(*)::int`.as('claim_count'),
            sql<number>`(coalesce(sum(b.balance_cents) filter (where c.status = 'open'), 0))::int`.as(
              'balance_cents'
            ),
            sql<string | null>`max(c.service_date)::text`.as('last_service_date')
          ])
          .whereRef('c.patient_id', '=', 'p.id')
          .as('claimed'),
      (join) => join.onTrue()
    )
    .select([
      'p.id',
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
    .where('p.tenant_id', '=', tenantId);

const PATIENT_ORDER = {
  name: sql`lower(p.last_name || ' ' || p.first_name)`,
  born: sql.ref('p.birth_date'),
  lastService: sql.ref('claimed.last_service_date'),
  balance: sql.ref('claimed.balance_cents')
};

export const listPatients = (db: Db, tenantId: string, f: PatientFilters) => {
  let q = patientRows(db, tenantId);
  const last = f.lastName ? nameKey(f.lastName) : '';
  if (last) q = q.where('p.last_name_key', 'like', `${escapeLike(last)}%`);
  const first = f.firstName?.trim().toLowerCase();
  if (first) q = q.where(sql`lower(p.first_name)`, 'like', `${escapeLike(first)}%`);
  if (f.birthDate) q = q.where('p.birth_date', '=', f.birthDate);
  return paged(q, f, PATIENT_ORDER, sql.ref('p.id'));
};

export const findPatient = (db: Db, tenantId: string, id: string) =>
  patientRows(db, tenantId).where('p.id', '=', id).executeTakeFirst();
