import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createApi } from '../../shared/api.ts';
import { claimSearchOf, createClaimsClient } from './client.ts';

describe('createClaimsClient', () => {
  it('reads claims and sends payer orders, payments and submissions', async () => {
    const seen: string[] = [];
    const client = createClaimsClient(
      createApi('http://api.test', async (url, init = {}) => {
        seen.push(`${init.method} ${String(url)} ${String(init.body ?? '')}`);
        return new Response('{"claims":[]}', { status: 200 });
      })
    );
    assert.deepEqual(
      await client.list({ status: 'open' }, 'page=2&pageSize=25&sort=balance&dir=desc'),
      { claims: [] }
    );
    await client.list(
      { status: 'all', lastName: ' doe ', number: '', birthDate: '1980-01-02', patientId: 'p1' },
      'page=1'
    );
    await client.find('c1');
    await client.events('c1', 'page=2&sort=amount');
    await client.setPayers('c1', [
      { name: 'Medicare', relationship: '18', insuredFirstName: null, insuredLastName: null }
    ]);
    await client.restartCycle('c1');
    await client.recordResponse('c1', {
      requestId: 'q1',
      kind: 'response',
      coverageId: null,
      paidCents: 500,
      adjustedCents: 0,
      paidOn: null,
      checkNumber: null,
      payerClaimNumber: null,
      adjustments: [],
      note: ''
    });
    await client.saveBillingData('c1', {
      serviceDate: null,
      pickup: { name: null, addressLine: null, city: null, state: null, postalCode: null },
      destination: { name: null, addressLine: null, city: null, state: null, postalCode: null },
      diagnoses: ['I10'],
      originDestination: 'RH',
      patient: { addressLine: null, city: null, state: null, postalCode: null },
      coverages: [],
      documentation: null
    });
    await client.eligibilityRequest('c1');
    await client.checkEligibility('c1');
    assert.equal(client.fileUrl('b1'), 'http://api.test/api/submissions/batches/b1/file');
    assert.equal(
      client.documentUrl('c 1', 'e/1'),
      'http://api.test/api/claims/c%201/events/e%2F1/document'
    );
    assert.equal(client.encounterUrl('r1'), 'http://api.test/api/imports/reports/r1/xml');
    assert.deepEqual(seen, [
      'GET http://api.test/api/claims?status=open&page=2&pageSize=25&sort=balance&dir=desc ',
      'GET http://api.test/api/claims?status=all&lastName=doe&birthDate=1980-01-02&patientId=p1&page=1 ',
      'GET http://api.test/api/claims/c1 ',
      'GET http://api.test/api/claims/c1/events?page=2&sort=amount ',
      'PUT http://api.test/api/claims/c1/payers {"payers":[{"name":"Medicare","relationship":"18","insuredFirstName":null,"insuredLastName":null}]}',
      'POST http://api.test/api/claims/c1/restart-cycle ',
      'POST http://api.test/api/claims/c1/responses {"requestId":"q1","kind":"response","coverageId":null,"paidCents":500,"adjustedCents":0,"paidOn":null,"checkNumber":null,"payerClaimNumber":null,"adjustments":[],"note":""}',
      'PUT http://api.test/api/claims/c1/billing-data {"serviceDate":null,"pickup":{"name":null,"addressLine":null,"city":null,"state":null,"postalCode":null},"destination":{"name":null,"addressLine":null,"city":null,"state":null,"postalCode":null},"diagnoses":["I10"],"originDestination":"RH","patient":{"addressLine":null,"city":null,"state":null,"postalCode":null},"coverages":[],"documentation":null}',
      'POST http://api.test/api/submissions/eligibility {"claimId":"c1"}',
      'POST http://api.test/api/submissions/eligibility-checks {"claimId":"c1"}'
    ]);
  });

  it('rejects with the message the server sends back', async () => {
    const client = createClaimsClient(
      createApi('', async () => new Response('{"error":"Claim is closed"}', { status: 409 }))
    );
    await assert.rejects(client.restartCycle('c1'), { message: 'Claim is closed', status: 409 });
  });

  it('reads the claim search from the URL', () => {
    assert.deepEqual(claimSearchOf(new URLSearchParams('')), {
      firstName: '',
      lastName: '',
      birthDate: '',
      number: ''
    });
    assert.deepEqual(
      claimSearchOf(new URLSearchParams('tab=search&lastName=doe&number=42&status=paid')),
      { firstName: '', lastName: 'doe', birthDate: '', number: '42' }
    );
  });
});
