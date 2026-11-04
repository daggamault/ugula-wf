import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findBillingProfile, upsertBillingProfile } from './queries.ts';

describe('billing profile queries', () => {
  it('reads the profile for one agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findBillingProfile(db, 't-1'), undefined);
    assert.ok(queries[0]?.sql.endsWith('from "billing_profiles" where "agency_id" = $1'));
    assert.deepEqual(queries[0]?.parameters, ['t-1']);
    await db.destroy();
  });

  it('upserts the agency profile and stores a blank receiver name as null', async () => {
    const { db, queries } = createRecordingDb(() => [{ organization_name: 'Acme EMS' }]);
    await upsertBillingProfile(db, 't-1', {
      organizationName: 'Acme EMS',
      npi: '1234567893',
      taxId: '123456789',
      addressLine: '100 Station Rd',
      city: 'Springfield',
      state: 'IL',
      postalCode: '627041234',
      phone: '2175550100',
      timeZone: 'America/Chicago',
      submitterId: null,
      receiverId: null,
      receiverName: '',
      production: true
    });
    const [upsert] = queries;
    assert.ok(upsert?.sql.startsWith('insert into "billing_profiles" ("agency_id", '));
    assert.ok(upsert?.sql.includes('on conflict ("agency_id") do update set'));
    assert.ok(upsert?.sql.includes('"updated_at" = now()'));
    assert.deepEqual(upsert?.parameters.slice(0, 14), [
      't-1',
      'Acme EMS',
      '1234567893',
      '123456789',
      '100 Station Rd',
      'Springfield',
      'IL',
      '627041234',
      '2175550100',
      'America/Chicago',
      null,
      null,
      null,
      true
    ]);
    await db.destroy();
  });
});
