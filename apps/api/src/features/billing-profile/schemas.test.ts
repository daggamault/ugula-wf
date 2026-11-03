import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as v from 'valibot';
import { billingProfileSchema } from './schemas.ts';

const valid = {
  organizationName: ' Acme EMS ',
  npi: '1234567893',
  taxId: '12-3456789',
  addressLine: '100 Station Rd',
  city: 'Springfield',
  state: 'il',
  postalCode: '62704-1234',
  phone: '(217) 555-0100',
  timeZone: ' America/Chicago ',
  submitterId: ' SUB01 ',
  receiverId: 'RCV01',
  receiverName: null,
  production: false
};

describe('billingProfileSchema', () => {
  it('normalizes identifiers, state, ZIP and phone to X12-ready forms', () => {
    assert.deepEqual(v.parse(billingProfileSchema, valid), {
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
      receiverName: null,
      production: false
    });
  });

  it('rejects malformed identifiers', () => {
    const fails = (over: Record<string, unknown>) =>
      !v.safeParse(billingProfileSchema, { ...valid, ...over }).success;
    assert.ok(fails({ npi: '123' }));
    assert.ok(fails({ npi: '1234567890' }));
    assert.ok(fails({ taxId: '1234' }));
    assert.ok(fails({ state: 'Illinois' }));
    assert.ok(fails({ postalCode: '6270' }));
    assert.ok(fails({ postalCode: '62704' }));
    assert.ok(fails({ timeZone: 'Mars/Olympus' }));
    assert.ok(fails({ organizationName: ' ' }));
    assert.ok(fails({ submitterId: 'has space' }));
    assert.ok(fails({ production: 'yes' }));
    assert.ok(!fails({ submitterId: null, receiverId: null }));
  });
});
