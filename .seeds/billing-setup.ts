import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const demoProfile = {
  organization_name: 'Development EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '100 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627041234',
  phone: '2175550100',
  submitter_id: 'DEVEMS01',
  receiver_id: 'DEMOCH',
  receiver_name: 'Demo Clearinghouse',
  time_zone: 'America/Chicago',
  production: false
};

const demoPayers = [
  { name: 'Medicare', payer_id: 'DEMOMCR', claim_filing: 'MB' },
  { name: 'Medicaid', payer_id: 'DEMOMCD', claim_filing: 'MC' },
  { name: 'Blue Plan', payer_id: 'DEMOBCBS', claim_filing: 'BL' }
];

export const buildUpsertDemoProfile = (db: Kysely<Database>, agencyId: string) =>
  db
    .insertInto('billing_profiles')
    .values({ agency_id: agencyId, ...demoProfile })
    .onConflict((oc) =>
      oc.column('agency_id').doUpdateSet({ ...demoProfile, updated_at: sql`now()` })
    );

export const buildUpsertDemoPayers = (db: Kysely<Database>, agencyId: string) =>
  db
    .insertInto('payers')
    .values(demoPayers.map((p) => ({ agency_id: agencyId, ...p })))
    .onConflict((oc) =>
      oc.expression(sql`agency_id, lower(name)`).doUpdateSet({
        payer_id: (eb) => eb.ref('excluded.payer_id'),
        claim_filing: (eb) => eb.ref('excluded.claim_filing'),
        updated_at: sql`now()`
      })
    );
