import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimInput } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { createClaimStore } from './queries.ts';

const CLAIM_ID = '0195f2a4-0000-7000-8000-000000000001';
const ENCOUNTER = '0195f2a4-0000-7000-8000-000000000002';
const PATIENT = '0195f2a4-0000-7000-8000-000000000003';
const PAYER = '0195f2a4-0000-7000-8000-000000000004';

const CLAIM: ClaimInput = {
  encounterId: ENCOUNTER,
  patientId: PATIENT,
  classification: 'emergency',
  serviceDate: '2026-09-14',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 11.6,
  originCode: 'R',
  destinationCode: 'H',
  diagnoses: ['R079'],
  transportReason: 'A',
  conditionCodes: ['06'],
  weightPounds: 180,
  pickup: { name: null, line: '1 Elm St', city: 'Dayton', state: 'OH', postalCode: '45402' },
  destination: {
    name: 'Miami Valley Hospital',
    line: '1 Wyoming St',
    city: 'Dayton',
    state: 'OH',
    postalCode: '45409'
  },
  priorAuthorization: null,
  signatureOnFile: true,
  note: null,
  coverages: [
    {
      payerId: PAYER,
      payerName: 'Medicare',
      memberId: 'M1',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  lines: [{ code: 'A0427', modifiers: ['RH'], units: 1, unitCents: 80000, totalCents: 80000 }],
  totalCents: 80000,
  reasons: ['Emergency response']
};

const tables = (sql: string) =>
  sql
    .match(/^(insert into|delete from) "(\w+)"/)
    ?.slice(1)
    .join(' ');

const queue = () => {
  const jobs: object[] = [];
  const boss: RunQueueClient = {
    insert: async (_, batch) => void jobs.push(...batch.map((j) => j.data))
  };
  return { boss, jobs };
};

const STALE_RUN = '0195f2a4-0000-7000-8000-000000000009';

const notSent = async () => ({ outcome: 'notApproved' as const });

const PATIENT_ROW = {
  patient_first_name: 'Ada',
  patient_last_name: 'Lovelace',
  patient_birth_date: '1950-12-10',
  patient_sex: 'F',
  patient_address_line: '1 Elm St',
  patient_city: 'Dayton',
  patient_state: 'OH',
  patient_postal_code: '45402'
};

const isPatientRead = (sql: string) =>
  sql.startsWith('select "first_name" as "patient_first_name"');

describe('createClaimStore', () => {
  it('reads a claim in the run agency with its payers, lines and diagnoses in order', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        id: CLAIM_ID,
        revision: 2,
        encounter_id: ENCOUNTER,
        patient_id: PATIENT,
        classification: 'emergency',
        service_date: '2026-09-14',
        level: 'ALS1',
        is_emergency: true,
        loaded_miles: '11.6',
        origin_code: 'R',
        destination_code: 'H',
        transport_reason: 'A',
        condition_codes: ['06'],
        weight_pounds: 180,
        pickup_name: null,
        pickup_address_line: '1 Elm St',
        pickup_city: 'Dayton',
        pickup_state: 'OH',
        pickup_postal_code: '45402',
        destination_name: 'Miami Valley Hospital',
        destination_address_line: '1 Wyoming St',
        destination_city: 'Dayton',
        destination_state: 'OH',
        destination_postal_code: '45409',
        prior_authorization: null,
        is_signature_on_file: true,
        note: null,
        total_cents: 80000,
        reasons: ['Emergency response'],
        diagnoses: ['R079'],
        coverages: [
          {
            payer_id: PAYER,
            payer_name: 'Medicare',
            member_id: 'M1',
            group_id: null,
            relationship: '18',
            insured_first_name: null,
            insured_last_name: null
          }
        ],
        lines: [
          { code: 'A0427', modifiers: ['RH'], units: 1, unit_cents: 80000, total_cents: 80000 }
        ]
      }
    ]);
    const store = createClaimStore(db, queue().boss, notSent);
    assert.deepEqual(await store.findClaim('r1', CLAIM_ID), {
      ...CLAIM,
      id: CLAIM_ID,
      revision: 2
    });
    assert.equal(await store.findClaim('r1', 'c-1'), null);
    assert.equal(queries.length, 1);
    const sql = queries[0]?.sql ?? '';
    assert.ok(sql.includes('order by "d"."position"'));
    assert.ok(sql.includes('order by "cc"."position"'));
    assert.ok(sql.includes('order by "l"."position"'));
    assert.ok(
      sql.endsWith(
        'where "c"."id" = $1 and "c"."agency_id" = (select "agency_id" from "workflow_runs" where "id" = $2)'
      )
    );
    assert.deepEqual(queries[0]?.parameters, [CLAIM_ID, 'r1']);
  });

  it('finds no claim outside the run agency', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await createClaimStore(db, queue().boss, notSent).findClaim('r1', CLAIM_ID), null);
  });

  it('saves the claim for its encounter and replaces its lines, payers and diagnoses', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 1, inserted: true }]
        : isPatientRead(q.sql)
          ? [PATIENT_ROW]
          : []
    );
    assert.deepEqual(await createClaimStore(db, queue().boss, notSent).saveClaim('r1', CLAIM), {
      id: CLAIM_ID,
      revision: 1,
      outcome: 'created'
    });
    assert.deepEqual(
      queries.map((q) => tables(q.sql)),
      [
        undefined,
        'insert into claims',
        'delete from claim_lines',
        'delete from claim_coverages',
        'delete from claim_diagnoses',
        'insert into claim_lines',
        'insert into claim_coverages',
        'insert into claim_diagnoses'
      ]
    );
    assert.match(
      queries[0]?.sql ?? '',
      /where "agency_id" = \(select "agency_id" from "workflow_runs" where "id" = \$1\) and "id" = \$2$/
    );
    assert.ok(queries[1]?.parameters.includes('Lovelace'));
    assert.ok(queries[1]?.parameters.includes('Miami Valley Hospital'));
    assert.match(
      queries[1]?.sql ?? '',
      /on conflict \("agency_id", "encounter_id"\) do update set/
    );
    assert.match(
      queries[1]?.sql ?? '',
      /"status" = \$\d+, "revision" = claims\.revision \+ 1, "reviewed_by" = \$\d+, "reviewed_at" = \$\d+, "review_note" = \$\d+/
    );
    assert.deepEqual(queries[5]?.parameters, [CLAIM_ID, 1, 'A0427', ['RH'], 1, 80000, 80000]);
  });

  it('refuses a claim for a patient outside the run agency', async () => {
    const { db } = createRecordingDb(() => []);
    await assert.rejects(
      createClaimStore(db, queue().boss, notSent).saveClaim('r1', CLAIM),
      new RegExp(`Patient ${PATIENT} does not exist`)
    );
  });

  it('cancels the review of the claim it replaces, so no stale review stays in the queue', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 2, inserted: false }]
        : q.sql.startsWith('select "r"."id" from "workflow_runs"')
          ? [{ id: STALE_RUN }]
          : isPatientRead(q.sql)
            ? [PATIENT_ROW]
            : []
    );
    const { boss, jobs } = queue();
    await createClaimStore(db, boss, notSent).saveClaim('r1', CLAIM);
    const stale = queries.find((q) => q.sql.startsWith('select "r"."id" from "workflow_runs"'));
    assert.match(stale?.sql ?? '', /"r"."status" = \$\d+ and r.inputs ->> 'encounterId' = \$\d+/);
    assert.match(stale?.sql ?? '', /"t"."permission" = \$\d+/);
    assert.ok(stale?.parameters.includes('claims:approve'));
    assert.ok(stale?.parameters.includes(ENCOUNTER));
    assert.deepEqual(jobs, [{ runId: STALE_RUN, command: { type: 'cancel' } }]);
  });

  it('cancels nothing for a new claim', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 1, inserted: true }]
        : isPatientRead(q.sql)
          ? [PATIENT_ROW]
          : []
    );
    const { boss, jobs } = queue();
    await createClaimStore(db, boss, notSent).saveClaim('r1', CLAIM);
    assert.ok(!queries.some((q) => q.sql.includes('"workflow_runs" as "r"')));
    assert.deepEqual(jobs, []);
  });

  it('replaces an existing claim and saves no empty lists', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 2, inserted: false }]
        : isPatientRead(q.sql)
          ? [PATIENT_ROW]
          : []
    );
    const saved = await createClaimStore(db, queue().boss, notSent).saveClaim('r1', {
      ...CLAIM,
      lines: [],
      coverages: [],
      diagnoses: [],
      totalCents: 0
    });
    assert.deepEqual([saved.outcome, saved.revision], ['replaced', 2]);
    assert.equal(queries.length, 6);
  });

  it('records a review only on the revision reviewed while it needs review', async () => {
    const USER = '0195f2a4-0000-7000-8000-000000000005';
    const review = {
      claimId: CLAIM_ID,
      revision: 2,
      decision: 'on_hold' as const,
      reviewedBy: USER,
      note: 'Need the PCS'
    };
    const recorded = createRecordingDb(() => [{ id: CLAIM_ID }]);
    assert.equal(
      await createClaimStore(recorded.db, queue().boss, notSent).reviewClaim('r1', review),
      'recorded'
    );
    const [update] = recorded.queries;
    assert.match(update?.sql ?? '', /^update "claims" set "status" = \$1, "reviewed_by" = \$2/);
    assert.match(
      update?.sql ?? '',
      /where "id" = \$\d+ and "agency_id" = \(select "agency_id" from "workflow_runs" where "id" = \$\d+\) and "revision" = \$\d+ and "status" = \$\d+/
    );
    assert.deepEqual(update?.parameters.slice(0, 3), ['on_hold', USER, 'Need the PCS']);
    const superseded = createRecordingDb(() => []);
    assert.equal(
      await createClaimStore(superseded.db, queue().boss, notSent).reviewClaim('r1', review),
      'superseded'
    );
    await assert.rejects(
      createClaimStore(superseded.db, queue().boss, notSent).reviewClaim('r1', {
        ...review,
        reviewedBy: 'u-1'
      }),
      /User u-1 does not exist/
    );
  });

  it('checks a claim of the run agency, and approves none that lacks what the 837P needs', async () => {
    const USER = '0195f2a4-0000-7000-8000-000000000005';
    const unaddressed = {
      id: CLAIM_ID,
      number: '20261001-0012',
      revision: 1,
      status: 'needs_review',
      ...Object.fromEntries(Object.keys(PATIENT_ROW).map((k) => [k, null])),
      patient_first_name: 'Ada',
      patient_last_name: 'Lovelace',
      patient_birth_date: '1950-12-10',
      condition_codes: [],
      is_signature_on_file: false,
      diagnoses: [],
      coverages: [],
      lines: []
    };
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"')
        ? [{ agency_id: 't-1' }]
        : q.sql.includes('from "claims" as "c"')
          ? [unaddressed]
          : []
    );
    const store = createClaimStore(db, queue().boss, notSent);
    assert.deepEqual(await store.checkClaim('r1', CLAIM_ID), [
      'The patient address has no street, city, state or ZIP code'
    ]);
    assert.equal(await store.checkClaim('r1', 'c-1'), null);
    const review = {
      claimId: CLAIM_ID,
      revision: 1,
      decision: 'approved' as const,
      reviewedBy: USER,
      note: null
    };
    queries.length = 0;
    assert.equal(await store.reviewClaim('r1', review), 'notReady');
    assert.ok(!queries.some((q) => q.sql.startsWith('update')));
  });

  it('keeps a claim already sent as it was sent', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? []
        : isPatientRead(q.sql)
          ? [PATIENT_ROW]
          : q.sql.startsWith('select "id", "revision" from "claims"')
            ? [{ id: CLAIM_ID, revision: 3 }]
            : []
    );
    assert.deepEqual(await createClaimStore(db, queue().boss, notSent).saveClaim('r1', CLAIM), {
      id: CLAIM_ID,
      revision: 3,
      outcome: 'alreadySent'
    });
    assert.match(
      queries.find((q) => q.sql.startsWith('insert into "claims"'))?.sql ?? '',
      /where "claims"\."status" <> \$\d+ returning/
    );
    assert.ok(!queries.some((q) => q.sql.startsWith('delete')));
  });

  it('refuses ids that are not ids before touching the database', async () => {
    const { db, queries } = createRecordingDb();
    await assert.rejects(
      createClaimStore(db, queue().boss, notSent).saveClaim('r1', { ...CLAIM, patientId: 'p-1' }),
      /Patient p-1 does not exist/
    );
    await assert.rejects(
      createClaimStore(db, queue().boss, notSent).saveClaim('r1', { ...CLAIM, encounterId: 'e-1' }),
      /Encounter e-1 does not exist/
    );
    await assert.rejects(
      createClaimStore(db, queue().boss, notSent).saveClaim('r1', {
        ...CLAIM,
        coverages: [
          { ...(CLAIM.coverages[0] as ClaimInput['coverages'][number]), payerId: 'pay-1' }
        ]
      }),
      /Payer pay-1 does not exist/
    );
    assert.equal(queries.filter((q) => !/^(begin|commit|rollback)/.test(q.sql)).length, 0);
  });
});
