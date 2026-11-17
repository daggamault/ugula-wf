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
  submitterId: ' sub01 ',
  receiverId: 'RCV01',
  receiverName: null,
  isProduction: false
};

const issues = (over: Record<string, unknown>) =>
  v.safeParse(billingProfileSchema, { ...valid, ...over }).issues?.map((i) => i.message);

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
      isProduction: false
    });
  });

  it('allows no clearinghouse IDs and trims the receiver name', () => {
    const parsed = v.parse(billingProfileSchema, {
      ...valid,
      submitterId: null,
      receiverId: null,
      receiverName: '  Demo  '
    });
    assert.deepEqual(
      [parsed.submitterId, parsed.receiverId, parsed.receiverName],
      [null, null, 'Demo']
    );
  });

  it('rejects an NPI that is short or fails its check digit', () => {
    assert.deepEqual(issues({ npi: '123' }), [
      'An NPI has 10 digits',
      'This NPI fails its check digit'
    ]);
    assert.deepEqual(issues({ npi: '1234567890' }), ['This NPI fails its check digit']);
  });

  it('rejects malformed tax ID, state, ZIP, phone and time zone', () => {
    assert.deepEqual(issues({ taxId: '1234' }), ['A tax ID (EIN) has 9 digits']);
    assert.deepEqual(issues({ state: 'Illinois' }), ['Use a 2-letter state']);
    assert.deepEqual(issues({ postalCode: '62704' }), ['Use the 9 digit ZIP+4 code']);
    assert.deepEqual(issues({ phone: '555-0100' }), ['A phone number has 10 digits']);
    assert.deepEqual(issues({ timeZone: 'Mars/Olympus' }), [
      'Choose a time zone such as America/Chicago'
    ]);
  });

  it('rejects blank or overlong names and addresses', () => {
    assert.deepEqual(issues({ organizationName: ' ' }), [
      'Invalid length: Expected !0 but received 0'
    ]);
    assert.deepEqual(issues({ organizationName: 'x'.repeat(61) }), [
      'Invalid length: Expected <=60 but received 61'
    ]);
    assert.deepEqual(issues({ addressLine: 'x'.repeat(56) }), [
      'Invalid length: Expected <=55 but received 56'
    ]);
    assert.deepEqual(issues({ city: 'x'.repeat(31) }), [
      'Invalid length: Expected <=30 but received 31'
    ]);
    assert.deepEqual(issues({ receiverName: 'x'.repeat(61) }), [
      'Invalid length: Expected <=60 but received 61'
    ]);
  });

  it('rejects clearinghouse IDs outside 2 to 15 letters or digits', () => {
    for (const id of ['has space', 'A', 'X'.repeat(16)]) {
      assert.deepEqual(issues({ submitterId: id }), [
        'Clearinghouse IDs are 2 to 15 letters or digits'
      ]);
    }
    assert.deepEqual(issues({ receiverId: 'A-1' }), [
      'Clearinghouse IDs are 2 to 15 letters or digits'
    ]);
  });

  it('requires a boolean production flag', () => {
    assert.deepEqual(issues({ isProduction: 'yes' }), [
      'Invalid type: Expected boolean but received "yes"'
    ]);
  });
});
