import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  eligibilityRequests,
  findEligibilityClaim,
  markEligibilityRequested,
  reuseEligibility
} from './eligibility.ts';
import { createRecordingDb } from './testing.ts';

const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';
const BLUE = '01a16617-7704-7ba6-b9b5-000000000002';

const evening = new Date('2026-11-01T03:00:00Z');

const row = {
  number: '20261105-1001',
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
      insured_last_name: null,
      asked: false
    },
    {
      id: BLUE,
      payer: 'Blue Plan',
      payer_id: 'BCBS1',
      member_id: 'XYZ1',
      relationship: '19',
      insured_first_name: 'John',
      insured_last_name: 'Doe',
      asked: false
    },
    {
      id: 'c2',
      payer: 'Unlisted',
      payer_id: null,
      member_id: 'Q',
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null,
      asked: false
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

describe('eligibilityRequests unless forced', () => {
  it('skips payers already answered or waiting for an answer', () => {
    const asked = {
      ...row,
      coverages: row.coverages.map((c) => ({ ...c, asked: c.id === MEDICARE }))
    };
    assert.deepEqual(
      eligibilityRequests(asked, evening, { force: false }).map((r) => r.trace),
      [BLUE]
    );
    assert.deepEqual(
      eligibilityRequests(asked, evening).map((r) => r.trace),
      [MEDICARE, BLUE]
    );
  });
});

describe('reuseEligibility', () => {
  it("copies another claim's answer for the same patient, payer and member ID in the same month of service", async () => {
    const { db, queries } = createRecordingDb(() => [{ id: MEDICARE }]);
    const r = await reuseEligibility(db, 't1', 'c1');
    assert.deepEqual(r.rows, [{ id: MEDICARE }]);
    const [q] = queries;
    assert.ok(q?.sql.includes('oc.patient_id = c.patient_id'));
    assert.ok(q?.sql.includes('lower(o.member_id) = lower(cc.member_id)'));
    assert.ok(
      q?.sql.includes("date_trunc('month', oc.service_date) = date_trunc('month', c.service_date)")
    );
    assert.ok(q?.sql.includes('cc.eligibility is null'));
    assert.ok(q?.sql.includes('cc.eligibility_requested_at is null'));
    assert.deepEqual(q?.parameters, ['t1', 'c1']);
  });
});

describe('markEligibilityRequested', () => {
  it('stamps the coverages asked about within the agency, and nothing when none were', async () => {
    const { db, queries } = createRecordingDb();
    const at = new Date('2026-11-05T12:00:00Z');
    await markEligibilityRequested(db, 't1', [MEDICARE], at);
    await markEligibilityRequested(db, 't1', [], at);
    assert.equal(queries.length, 1);
    assert.match(
      queries[0]?.sql ?? '',
      /update "claim_coverages" set "eligibility_requested_at" = \$1/
    );
    assert.deepEqual(queries[0]?.parameters, [at, 't1', MEDICARE]);
  });
});
