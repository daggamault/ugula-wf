import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBillingProfile, upsertBillingProfile } from './queries.ts';

const COLUMNS =
  '"organization_name", "npi", "tax_id", "address_line", "city", "state", "postal_code", ' +
  '"phone", "time_zone", "submitter_id", "receiver_id", "receiver_name", "is_production", ' +
  '"updated_at"';

const PROFILE = {
  organizationName: 'Acme EMS',
  npi: '1234567893',
  taxId: '123456789',
  addressLine: '100 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postalCode: '627041234',
  phone: '2175550100',
  timeZone: 'America/Chicago',
  submitterId: 'SUB01',
  receiverId: 'RCV01',
  receiverName: 'Demo Clearinghouse',
  isProduction: true
};

const VALUES = [
  'Acme EMS',
  '1234567893',
  '123456789',
  '100 Station Rd',
  'Springfield',
  'IL',
  '627041234',
  '2175550100',
  'America/Chicago',
  'SUB01',
  'RCV01',
  'Demo Clearinghouse',
  true
];

describe('findBillingProfile', () => {
  it('reads the profile for one agency', async () => {
    const row = { organization_name: 'Acme EMS' };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await findBillingProfile(db, 't-1'), row);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [[`select ${COLUMNS} from "billing_profiles" where "agency_id" = $1`, ['t-1']]]
    );
    await db.destroy();
  });

  it('finds nothing for an agency without a profile', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findBillingProfile(db, 't-1'), undefined);
    await db.destroy();
  });
});

describe('upsertBillingProfile', () => {
  it('inserts the agency profile or updates every field and the time on conflict', async () => {
    const row = { organization_name: 'Acme EMS' };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(await upsertBillingProfile(db, 't-1', PROFILE), row);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "billing_profiles" ("agency_id", "organization_name", "npi", "tax_id", ' +
            '"address_line", "city", "state", "postal_code", "phone", "time_zone", ' +
            '"submitter_id", "receiver_id", "receiver_name", "is_production") values ' +
            '($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) ' +
            'on conflict ("agency_id") do update set "organization_name" = $15, "npi" = $16, ' +
            '"tax_id" = $17, "address_line" = $18, "city" = $19, "state" = $20, ' +
            '"postal_code" = $21, "phone" = $22, "time_zone" = $23, "submitter_id" = $24, ' +
            '"receiver_id" = $25, "receiver_name" = $26, "is_production" = $27, ' +
            `"updated_at" = now() returning ${COLUMNS}`,
          ['t-1', ...VALUES, ...VALUES]
        ]
      ]
    );
    await db.destroy();
  });

  it('stores a blank receiver name as null', async () => {
    const { db, queries } = createRecordingDb(() => [{}]);
    await upsertBillingProfile(db, 't-1', { ...PROFILE, receiverName: '' });
    assert.equal(queries[0]?.parameters[12], null);
    assert.equal(queries[0]?.parameters[25], null);
    await db.destroy();
  });

  it('throws when the upsert returns no row', async () => {
    const { db } = createRecordingDb(() => []);
    await assert.rejects(upsertBillingProfile(db, 't-1', PROFILE), { message: 'no result' });
    await db.destroy();
  });
});
