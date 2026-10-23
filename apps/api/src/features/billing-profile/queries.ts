import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';
import type { BillingProfileInput } from './schemas.ts';

type Db = Kysely<Database>;

const columns = [
  'organization_name',
  'npi',
  'tax_id',
  'address_line',
  'city',
  'state',
  'postal_code',
  'phone',
  'submitter_id',
  'receiver_id',
  'receiver_name',
  'production',
  'updated_at'
] as const;

export const findBillingProfile = (db: Db, tenantId: string) =>
  db
    .selectFrom('billing_profiles')
    .select(columns)
    .where('tenant_id', '=', tenantId)
    .executeTakeFirst();

export const upsertBillingProfile = (db: Db, tenantId: string, p: BillingProfileInput) => {
  const values = {
    organization_name: p.organizationName,
    npi: p.npi,
    tax_id: p.taxId,
    address_line: p.addressLine,
    city: p.city,
    state: p.state,
    postal_code: p.postalCode,
    phone: p.phone,
    submitter_id: p.submitterId,
    receiver_id: p.receiverId,
    receiver_name: p.receiverName || null,
    production: p.production
  };
  return db
    .insertInto('billing_profiles')
    .values({ tenant_id: tenantId, ...values })
    .onConflict((oc) => oc.column('tenant_id').doUpdateSet({ ...values, updated_at: sql`now()` }))
    .returning(columns)
    .executeTakeFirstOrThrow();
};
