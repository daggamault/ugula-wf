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
  receiver_id: 'WAYSTAR',
  receiver_name: 'Waystar',
  time_zone: 'America/Chicago',
  production: false
};

const demoPayers = [
  { name: 'Medicare', payer_id: 'DEMOMCR', claim_filing: 'MB' },
  { name: 'Medicaid', payer_id: 'DEMOMCD', claim_filing: 'MC' },
  { name: 'Blue Plan', payer_id: 'DEMOBCBS', claim_filing: 'BL' },
  { name: 'Keystone Comp', payer_id: 'DEMOWC', claim_filing: 'WC' }
];

const demoFacilities = [
  {
    name: 'UPMC Harrisburg',
    kind: 'hospital',
    address_line: '111 S Front St',
    city: 'Harrisburg',
    state: 'PA',
    postal_code: '17101',
    contract: false,
    contract_note: null
  },
  {
    name: 'Spring Creek Skilled Nursing and Rehabilitation',
    kind: 'snf',
    address_line: null,
    city: 'Harrisburg',
    state: 'PA',
    postal_code: null,
    contract: false,
    contract_note: null
  },
  {
    name: 'Riverside Rehabilitation Center',
    kind: 'other',
    address_line: '3800 Riverside Dr',
    city: 'Harrisburg',
    state: 'PA',
    postal_code: '17110',
    contract: true,
    contract_note: 'Pays every scheduled transport of its residents under contract'
  }
] as const;

export const buildUpsertDemoProfile = (
  db: Kysely<Database>,
  agencyId: string,
  submitterId: string
) => {
  const profile = { ...demoProfile, submitter_id: submitterId };
  return db
    .insertInto('billing_profiles')
    .values({ agency_id: agencyId, ...profile })
    .onConflict((oc) => oc.column('agency_id').doUpdateSet({ ...profile, updated_at: sql`now()` }));
};

export const buildUpsertDemoFacilities = (db: Kysely<Database>, agencyId: string) =>
  db
    .insertInto('facilities')
    .values(demoFacilities.map((f) => ({ agency_id: agencyId, ...f })))
    .onConflict((oc) =>
      oc.expression(sql`agency_id, lower(name)`).doUpdateSet({
        kind: (eb) => eb.ref('excluded.kind'),
        address_line: (eb) => eb.ref('excluded.address_line'),
        city: (eb) => eb.ref('excluded.city'),
        state: (eb) => eb.ref('excluded.state'),
        postal_code: (eb) => eb.ref('excluded.postal_code'),
        contract: (eb) => eb.ref('excluded.contract'),
        contract_note: (eb) => eb.ref('excluded.contract_note'),
        updated_at: sql`now()`
      })
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
