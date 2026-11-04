import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createBillingProfileService } from './service.ts';

const profile = {
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
  receiverName: '',
  production: false
};

describe('billing profile service', () => {
  it('reads nothing until saved, then upserts one profile per agency', async () => {
    const empty = createBillingProfileService({ db: createRecordingDb(() => []).db });
    assert.deepEqual(await empty.find('t-1'), { ok: true, value: { profile: null } });
    const { db, queries } = createRecordingDb(() => [{ organization_name: 'Acme EMS' }]);
    const service = createBillingProfileService({ db });
    assert.deepEqual(await service.save('t-1', profile), {
      ok: true,
      value: { profile: { organization_name: 'Acme EMS' } }
    });
    assert.ok(queries[0]?.sql.includes('on conflict ("agency_id") do update set'));
    assert.equal(queries[0]?.parameters[0], 't-1');
  });
});
