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

describe('createClaimStore', () => {
  it('saves the claim for its encounter and replaces its lines, payers and diagnoses', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 1, inserted: true }]
        : []
    );
    assert.deepEqual(await createClaimStore(db, queue().boss).saveClaim('r1', CLAIM), {
      id: CLAIM_ID,
      revision: 1,
      outcome: 'created'
    });
    assert.deepEqual(
      queries.map((q) => tables(q.sql)),
      [
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
      /on conflict \("agency_id", "encounter_id"\) do update set/
    );
    assert.match(
      queries[0]?.sql ?? '',
      /"status" = \$\d+, "revision" = claims\.revision \+ 1, "reviewed_by" = \$\d+, "reviewed_at" = \$\d+, "review_note" = \$\d+/
    );
    assert.deepEqual(queries[4]?.parameters, [CLAIM_ID, 1, 'A0427', ['RH'], 1, 80000, 80000]);
  });

  it('cancels the review of the claim it replaces, so no stale review stays in the queue', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 2, inserted: false }]
        : q.sql.startsWith('select "r"."id" from "workflow_runs"')
          ? [{ id: STALE_RUN }]
          : []
    );
    const { boss, jobs } = queue();
    await createClaimStore(db, boss).saveClaim('r1', CLAIM);
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
        : []
    );
    const { boss, jobs } = queue();
    await createClaimStore(db, boss).saveClaim('r1', CLAIM);
    assert.ok(!queries.some((q) => q.sql.includes('"workflow_runs" as "r"')));
    assert.deepEqual(jobs, []);
  });

  it('replaces an existing claim and saves no empty lists', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"')
        ? [{ id: CLAIM_ID, agency_id: 't-1', revision: 2, inserted: false }]
        : []
    );
    const saved = await createClaimStore(db, queue().boss).saveClaim('r1', {
      ...CLAIM,
      lines: [],
      coverages: [],
      diagnoses: [],
      totalCents: 0
    });
    assert.deepEqual([saved.outcome, saved.revision], ['replaced', 2]);
    assert.equal(queries.length, 5);
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
      await createClaimStore(recorded.db, queue().boss).reviewClaim('r1', review),
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
      await createClaimStore(superseded.db, queue().boss).reviewClaim('r1', review),
      'superseded'
    );
    await assert.rejects(
      createClaimStore(superseded.db, queue().boss).reviewClaim('r1', {
        ...review,
        reviewedBy: 'u-1'
      }),
      /User u-1 does not exist/
    );
  });

  it('refuses ids that are not ids before touching the database', async () => {
    const { db, queries } = createRecordingDb();
    await assert.rejects(
      createClaimStore(db, queue().boss).saveClaim('r1', { ...CLAIM, patientId: 'p-1' }),
      /Patient p-1 does not exist/
    );
    await assert.rejects(
      createClaimStore(db, queue().boss).saveClaim('r1', { ...CLAIM, encounterId: 'e-1' }),
      /Encounter e-1 does not exist/
    );
    await assert.rejects(
      createClaimStore(db, queue().boss).saveClaim('r1', {
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
