import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createSubmissionService, eligibilityRequests } from './service.ts';

const C1 = '01a16617-7704-7ba6-b9b5-9c79fa44f961';
const C2 = '01a16617-7704-7ba6-b9b5-9c79fa44f962';
const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';
const BLUE = '01a16617-7704-7ba6-b9b5-000000000002';

const now = new Date('2026-10-23T12:00:00Z');

const profile = {
  organization_name: 'Metro EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '1 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627011234',
  phone: '2175550100',
  submitter_id: 'SUB01',
  receiver_id: 'RCV01',
  receiver_name: 'Demo Clearinghouse',
  production: false
};

const claimRow = (id: string) => ({ id });

const batch = {
  document: { bucket: 'ugula', key: 't1/batches/837P-000000007.txt', contentType: 'text/plain' },
  control_number: 7
};

const setup = ({ rows = [claimRow(C1)], withProfile = true, controlNumbers = true } = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('update "billing_profiles"')) {
      return controlNumbers ? [{ control_number: 7 }] : [];
    }
    if (q.sql.includes('from "claim_batches"')) return q.parameters.includes(C1) ? [batch] : [];
    if (q.sql.includes('from "billing_profiles"')) return withProfile ? [profile] : [];
    if (q.sql.includes('from "claims" as "c"')) return rows;
    return [];
  });
  const fetched: unknown[] = [];
  const blobs = {
    getBytes: async (ref: unknown) => {
      fetched.push(ref);
      return new TextEncoder().encode('ISA*');
    }
  };
  return { queries, fetched, service: createSubmissionService({ db, blobs, now: () => now }) };
};

describe('eligibility requests', () => {
  const row = {
    number: 1001,
    service_date: null,
    first_name: 'Jane',
    last_name: 'Doe',
    birth_date: '1950-02-03',
    gender: 'F' as const,
    coverages: [
      {
        id: MEDICARE,
        payer: 'Medicare',
        payer_id: 'DEMOMCR',
        member_id: '1EG4TE5MK73',
        relationship: '18',
        insured_first_name: null,
        insured_last_name: null
      },
      {
        id: BLUE,
        payer: 'Blue Plan',
        payer_id: 'BCBS1',
        member_id: 'XYZ1',
        relationship: '19',
        insured_first_name: 'John',
        insured_last_name: 'Doe'
      },
      {
        id: C2,
        payer: 'Unlisted',
        payer_id: null,
        member_id: 'Q',
        relationship: '18',
        insured_first_name: null,
        insured_last_name: null
      }
    ]
  };

  it('asks each linked payer about the patient or the insured, traced by coverage', () => {
    assert.deepEqual(eligibilityRequests(row, '2026-10-31'), [
      {
        trace: MEDICARE,
        payer: { name: 'Medicare', payerId: 'DEMOMCR' },
        subscriber: {
          lastName: 'Doe',
          firstName: 'Jane',
          memberId: '1EG4TE5MK73',
          birthDate: '1950-02-03',
          sex: 'F'
        },
        serviceDate: '2026-10-31'
      },
      {
        trace: BLUE,
        payer: { name: 'Blue Plan', payerId: 'BCBS1' },
        subscriber: {
          lastName: 'Doe',
          firstName: 'John',
          memberId: 'XYZ1',
          birthDate: null,
          sex: null
        },
        serviceDate: '2026-10-31'
      }
    ]);
  });

  it('builds a 270 with a fresh control number, or says what is missing', async () => {
    const built = await setup({
      rows: [{ ...claimRow(C1), ...row }]
    }).service.eligibility('t1', C1);
    assert.ok(built.ok && built.value.file.includes('ST*270*0001*005010X279A1'));
    assert.ok(built.ok && built.value.name === 'eligibility-1001-7.x12');
    const none = await setup({ rows: [] }).service.eligibility('t1', C1);
    assert.equal(none.ok ? null : none.failure.code, 'not_found');
    const noProfile = await setup({ withProfile: false }).service.eligibility('t1', C1);
    assert.equal(noProfile.ok ? null : noProfile.failure.code, 'invalid');
  });

  it('refuses a claim no payer can be asked about and a tenant out of control numbers', async () => {
    const unlisted = { ...row, coverages: row.coverages.slice(2) };
    const nobody = await setup({ rows: [{ ...claimRow(C1), ...unlisted }] }).service.eligibility(
      't1',
      C1
    );
    assert.equal(nobody.ok ? null : nobody.failure.code, 'invalid');
    assert.match(nobody.ok ? '' : nobody.failure.message, /member ID/);
    const exhausted = await setup({
      rows: [{ ...claimRow(C1), ...row }],
      controlNumbers: false
    }).service.eligibility('t1', C1);
    assert.equal(exhausted.ok ? null : exhausted.failure.code, 'conflict');
  });

  it('looks up the claim, profile and control number of the tenant only', async () => {
    const { service, queries } = setup({ rows: [{ ...claimRow(C1), ...row }] });
    assert.ok((await service.eligibility('t1', C1)).ok);
    assert.equal(queries.length, 3);
    for (const q of queries) assert.ok(q.parameters.includes('t1'), q.sql);
  });
});

describe('batch documents', () => {
  it('downloads a tenant batch file named after its key, or reports it missing', async () => {
    const { service, queries, fetched } = setup();
    assert.deepEqual(await service.document('t1', C1), {
      ok: true,
      value: {
        bytes: new TextEncoder().encode('ISA*'),
        contentType: 'text/plain',
        name: '837P-000000007.txt'
      }
    });
    assert.deepEqual(fetched, [batch.document]);
    assert.deepEqual(queries[0]?.parameters, ['t1', C1]);
    const missing = await service.document('t1', C2);
    assert.equal(missing.ok ? null : missing.failure.code, 'not_found');
    assert.equal(fetched.length, 1);
  });
});
