import { payerKey } from '@ugula/billing';
import type { Database } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const devProfile = {
  organization_name: 'Development EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '100 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627041234',
  phone: '2175550100',
  receiver_id: 'WAYSTAR',
  receiver_name: 'Waystar',
  time_zone: 'America/Chicago',
  is_production: false
};

const devPayers = [
  { name: 'Medicare', payer_code: 'DEMOMCR', claim_filing: 'MB' },
  { name: 'Medicaid', payer_code: 'DEMOMCD', claim_filing: 'MC' },
  { name: 'Blue Plan', payer_code: 'DEMOBCBS', claim_filing: 'BL' },
  { name: 'Keystone Comp', payer_code: 'DEMOWC', claim_filing: 'WC' },
  { name: 'Keystone Auto', payer_code: 'DEMOAUTO', claim_filing: 'CI' }
] as const;

const devPayerAliases = [{ payer: 'Medicare', alias: 'Simulated Medicare Part B' }] as const;

const devFacilities = [
  {
    name: 'UPMC Harrisburg',
    kind: 'hospital',
    address_line: '111 S Front St',
    city: 'Harrisburg',
    state: 'PA',
    postal_code: '17101',
    has_contract: false,
    contract_note: null
  },
  {
    name: 'Spring Creek Skilled Nursing and Rehabilitation',
    kind: 'snf',
    address_line: null,
    city: 'Harrisburg',
    state: 'PA',
    postal_code: null,
    has_contract: false,
    contract_note: null
  },
  {
    name: 'Riverside Rehabilitation Center',
    kind: 'other',
    address_line: '3800 Riverside Dr',
    city: 'Harrisburg',
    state: 'PA',
    postal_code: '17110',
    has_contract: true,
    contract_note: 'Pays every scheduled transport of its residents under contract'
  }
] as const;

export const buildUpsertDevProfile = (
  db: Kysely<Database>,
  agencyId: string,
  submitterId: string
) => {
  const profile = { ...devProfile, submitter_id: submitterId };
  return db
    .insertInto('billing_profiles')
    .values({ agency_id: agencyId, ...profile })
    .onConflict((oc) => oc.column('agency_id').doUpdateSet({ ...profile, updated_at: sql`now()` }));
};

export const buildUpsertDevFacilities = (db: Kysely<Database>, agencyId: string) =>
  db
    .insertInto('facilities')
    .values(devFacilities.map((f) => ({ agency_id: agencyId, ...f })))
    .onConflict((oc) =>
      oc.expression(sql`agency_id, lower(name)`).doUpdateSet({
        kind: (eb) => eb.ref('excluded.kind'),
        address_line: (eb) => eb.ref('excluded.address_line'),
        city: (eb) => eb.ref('excluded.city'),
        state: (eb) => eb.ref('excluded.state'),
        postal_code: (eb) => eb.ref('excluded.postal_code'),
        has_contract: (eb) => eb.ref('excluded.has_contract'),
        contract_note: (eb) => eb.ref('excluded.contract_note'),
        updated_at: sql`now()`
      })
    );

export const buildUpsertDevPayers = (db: Kysely<Database>, agencyId: string) =>
  db
    .insertInto('payers')
    .values(devPayers.map((p) => ({ agency_id: agencyId, ...p })))
    .onConflict((oc) =>
      oc.expression(sql`agency_id, lower(name)`).doUpdateSet({
        payer_code: (eb) => eb.ref('excluded.payer_code'),
        claim_filing: (eb) => eb.ref('excluded.claim_filing'),
        updated_at: sql`now()`
      })
    );

export const upsertDevPayerAliases = async (db: Kysely<Database>, agencyId: string) => {
  for (const { payer, alias } of devPayerAliases) {
    await db
      .insertInto('payer_aliases')
      .columns(['agency_id', 'payer_id', 'alias', 'alias_key'])
      .expression(
        db
          .selectFrom('payers')
          .select([
            'agency_id',
            'id',
            sql<string>`${alias}::text`.as('alias'),
            sql<string>`${payerKey(alias)}::text`.as('alias_key')
          ])
          .where('agency_id', '=', agencyId)
          .where(sql`lower(name)`, '=', payer.toLowerCase())
      )
      .onConflict((oc) => oc.columns(['agency_id', 'alias_key']).doNothing())
      .execute();
  }
};
