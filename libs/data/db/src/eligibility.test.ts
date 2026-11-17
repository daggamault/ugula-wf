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

type ClaimRow = Parameters<typeof eligibilityRequests>[0];

const medicare: ClaimRow['coverages'][number] = {
  id: MEDICARE,
  payer: 'Medicare',
  payer_code: 'DEMOMCR',
  member_id: '1EG4TE5MK73',
  relationship: '18',
  insured_first_name: null,
  insured_last_name: null,
  asked: false
};

const blue: ClaimRow['coverages'][number] = {
  id: BLUE,
  payer: 'Blue Plan',
  payer_code: 'BCBS1',
  member_id: 'XYZ1',
  relationship: '19',
  insured_first_name: 'John',
  insured_last_name: 'Doe',
  asked: false
};

const row: ClaimRow = {
  number: '20261105-1001',
  service_date: null,
  first_name: 'Jane',
  last_name: 'Doe',
  birth_date: '1950-02-03',
  gender: 'F',
  time_zone: 'America/Chicago',
  coverages: [
    medicare,
    blue,
    {
      id: 'c2',
      payer: 'Unlisted',
      payer_code: null,
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
    assert.equal(
      claim?.sql,
      `select "c"."number", "c"."service_date", "p"."first_name", "p"."last_name", "p"."birth_date", "p"."gender", coalesce((select bp.time_zone from billing_profiles bp where bp.agency_id = "c"."agency_id"), 'UTC') as "time_zone", (select coalesce(json_agg(agg), '[]') from (select "cc"."id", coalesce(dp.name, cc.payer_name) as "payer", "dp"."payer_code", "cc"."member_id", cc.relationship as "relationship", "cc"."insured_first_name", "cc"."insured_last_name", cc.eligibility is not null or cc.eligibility_requested_at is not null as "asked" from "claim_coverages" as "cc" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" where "cc"."claim_id" = "c"."id" order by "cc"."position") as agg) as "coverages" from "claims" as "c" inner join "patients" as "p" on "p"."id" = "c"."patient_id" where "c"."agency_id" = $1 and "c"."id" = $2`
    );
    assert.deepEqual(claim?.parameters, ['t1', 'c1']);
    await db.destroy();
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
      eligibilityRequests({ ...row, coverages: [{ ...blue, insured_last_name: null }] }, evening),
      []
    );
  });

  it('asks nothing of a payer without a member ID', () => {
    assert.deepEqual(
      eligibilityRequests({ ...row, coverages: [{ ...medicare, member_id: null }] }, evening),
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
    assert.equal(
      q?.sql.replace(/\s+/g, ' ').trim(),
      "update claim_coverages cc set eligibility = prior.eligibility, eligibility_note = concat_ws('; ', 'From claim ' || prior.number, prior.eligibility_note), eligibility_checked_at = prior.eligibility_checked_at from ( select distinct on (t.id) t.id, o.eligibility, o.eligibility_note, o.eligibility_checked_at, oc.number from claim_coverages t join claims c on c.id = t.claim_id and c.agency_id = t.agency_id join claim_coverages o on o.agency_id = t.agency_id and o.claim_id <> t.claim_id and o.payer_id = t.payer_id and lower(o.member_id) = lower(t.member_id) and o.relationship = t.relationship and o.eligibility is not null join claims oc on oc.id = o.claim_id and oc.agency_id = o.agency_id and oc.patient_id = c.patient_id and date_trunc('month', oc.service_date) = date_trunc('month', c.service_date) where c.agency_id = $1 and c.id = $2 and t.eligibility is null and t.eligibility_requested_at is null order by t.id, o.eligibility_checked_at desc ) prior where cc.id = prior.id returning cc.id"
    );
    assert.deepEqual(q?.parameters, ['t1', 'c1']);
    await db.destroy();
  });
});

describe('markEligibilityRequested', () => {
  it('stamps the coverages asked about within the agency, and nothing when none were', async () => {
    const { db, queries } = createRecordingDb();
    const at = new Date('2026-11-05T12:00:00Z');
    await markEligibilityRequested(db, 't1', [MEDICARE, BLUE], at);
    assert.deepEqual(await markEligibilityRequested(db, 't1', [], at), []);
    assert.equal(queries.length, 1);
    assert.equal(
      queries[0]?.sql,
      'update "claim_coverages" set "eligibility_requested_at" = $1 where "agency_id" = $2 and "id" in ($3, $4)'
    );
    assert.deepEqual(queries[0]?.parameters, [at, 't1', MEDICARE, BLUE]);
    await db.destroy();
  });
});
