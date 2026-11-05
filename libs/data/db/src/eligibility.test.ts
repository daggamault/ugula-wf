import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { eligibilityRequests, findEligibilityClaim } from './eligibility.ts';
import { createRecordingDb } from './testing.ts';

const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';
const BLUE = '01a16617-7704-7ba6-b9b5-000000000002';

const evening = new Date('2026-11-01T03:00:00Z');

const row = {
  number: 1001,
  service_date: null,
  first_name: 'Jane',
  last_name: 'Doe',
  birth_date: '1950-02-03',
  gender: 'F' as const,
  time_zone: 'America/Chicago',
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
      id: 'c2',
      payer: 'Unlisted',
      payer_id: null,
      member_id: 'Q',
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null
    }
  ]
};

describe('findEligibilityClaim', () => {
  it('finds a claim with its coverages in payer order only within the agency', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findEligibilityClaim(db, 't1', 'c1'), undefined);
    const [claim] = queries;
    assert.ok(claim?.sql.includes('where "cc"."claim_id" = "c"."id" order by "cc"."position"'));
    assert.ok(claim?.sql.includes('where "c"."agency_id" = $1 and "c"."id" = $2'));
    assert.deepEqual(claim?.parameters, ['t1', 'c1']);
  });
});

describe('eligibilityRequests', () => {
  it('asks each linked payer about the patient or the insured, traced by coverage, on the agency date', () => {
    assert.deepEqual(eligibilityRequests(row, evening), [
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
    assert.equal(
      eligibilityRequests({ ...row, service_date: '2026-09-01' }, evening)[0]?.serviceDate,
      '2026-09-01'
    );
    assert.deepEqual(
      eligibilityRequests(
        { ...row, coverages: [{ ...row.coverages[1], insured_last_name: null }] } as typeof row,
        evening
      ),
      []
    );
  });
});
