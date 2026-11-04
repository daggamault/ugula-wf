import type { Db } from '@ugula/db';
import { sql } from 'kysely';
import type { BillingProfileInput } from './schemas.ts';

const columns = [
  'organization_name',
  'npi',
  'tax_id',
  'address_line',
  'city',
  'state',
  'postal_code',
  'phone',
  'time_zone',
  'submitter_id',
  'receiver_id',
  'receiver_name',
  'production',
  'updated_at'
] as const;

export const findBillingProfile = (db: Db, agencyId: string) =>
  db
    .selectFrom('billing_profiles')
    .select(columns)
    .where('agency_id', '=', agencyId)
    .executeTakeFirst();

export const upsertBillingProfile = (db: Db, agencyId: string, p: BillingProfileInput) => {
  const values = {
    organization_name: p.organizationName,
    npi: p.npi,
    tax_id: p.taxId,
    address_line: p.addressLine,
    city: p.city,
    state: p.state,
    postal_code: p.postalCode,
    phone: p.phone,
    time_zone: p.timeZone,
    submitter_id: p.submitterId,
    receiver_id: p.receiverId,
    receiver_name: p.receiverName || null,
    production: p.production
  };
  return db
    .insertInto('billing_profiles')
    .values({ agency_id: agencyId, ...values })
    .onConflict((oc) => oc.column('agency_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
    .returning(columns)
    .executeTakeFirstOrThrow();
};
