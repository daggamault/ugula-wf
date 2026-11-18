import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import {
  cancelStaleReviews,
  checkClaim,
  findClaimSubmission,
  findSubmitter,
  replaceClaimParts
} from './claims.ts';
import { createRecordingDb } from './testing.ts';

const CLAIM_ROW = {
  id: 'c-1',
  number: '20261001-0012',
  revision: 2,
  status: 'needs_review',
  service_date: '2026-10-01',
  loaded_miles: '7.4',
  transport_reason: 'A',
  condition_codes: ['06'],
  weight_pounds: null,
  patient_first_name: 'Ada',
  patient_last_name: 'Lovelace',
  patient_birth_date: '1950-12-10',
  patient_sex: 'F',
  patient_address_line: '1 Elm St',
  patient_city: 'Dayton',
  patient_state: 'OH',
  patient_postal_code: '45402',
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
  diagnoses: ['R079'],
  coverages: [
    {
      payer_name: 'Medicare',
      directory_name: 'Medicare Part B',
      payer_code: 'DEMOMCR',
      claim_filing: 'MB',
      member_id: '1EG4TE5MK73',
      group_id: null,
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null,
      status: 'pending',
      adjudication: null
    },
    {
      payer_name: 'Unknown Plan',
      directory_name: null,
      payer_code: null,
      claim_filing: null,
      member_id: null,
      group_id: null,
      relationship: '01',
      insured_first_name: null,
      insured_last_name: null,
      status: 'pending',
      adjudication: null
    }
  ],
  lines: [{ code: 'A0427', modifiers: ['RH'], units: '1.00', total_cents: 85_000 }]
};

const PROFILE_ROW = {
  organization_name: 'Metro EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627011234',
  phone: '2175550100',
  submitter_id: 'SUB01',
  receiver_id: 'WAYSTAR',
  receiver_name: null,
  is_production: false
};

const rows = (sql: string) =>
  sql.includes('from "claims"')
    ? [CLAIM_ROW]
    : sql.includes('from "billing_profiles"')
      ? [PROFILE_ROW]
      : [];

describe('findClaimSubmission', () => {
  it('reads a claim of the agency as the 837P needs it, with each payer from the directory', async () => {
    const { db, queries } = createRecordingDb((q) => rows(q.sql));
    const claim = await findClaimSubmission(db, 't-1', 'c-1');
    assert.ok(claim);
    assert.deepEqual([claim.loadedMiles, claim.revision, claim.status], [7.4, 2, 'needs_review']);
    assert.deepEqual(claim.coverages[0]?.payer, {
      name: 'Medicare Part B',
      payerCode: 'DEMOMCR',
      claimFiling: 'MB'
    });
    assert.equal(claim.coverages[1]?.payer, null);
    assert.deepEqual(claim.lines, [
      { code: 'A0427', modifiers: ['RH'], units: 1, totalCents: 85_000 }
    ]);
    assert.deepEqual(claim.destination, {
      name: 'Miami Valley Hospital',
      line: '1 Wyoming St',
      city: 'Dayton',
      state: 'OH',
      postalCode: '45409'
    });
    assert.ok(queries[0]?.sql.endsWith('where "c"."agency_id" = $1 and "c"."id" = $2'));
    assert.deepEqual(queries[0]?.parameters.slice(-2), ['t-1', 'c-1']);
  });

  it('finds no claim outside the agency', async () => {
    const { db } = createRecordingDb();
    assert.equal(await findClaimSubmission(db, 't-1', 'c-1'), null);
  });
});

describe('findSubmitter', () => {
  it('reads the billing profile as the submitter of the 837P', async () => {
    const { db } = createRecordingDb((q) => rows(q.sql));
    assert.deepEqual(await findSubmitter(db, 't-1'), {
      organizationName: 'Metro EMS',
      npi: '1234567893',
      taxId: '123456789',
      addressLine: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '627011234',
      phone: '2175550100',
      submitterId: 'SUB01',
      receiverId: 'WAYSTAR',
      receiverName: null,
      production: false
    });
    assert.equal(await findSubmitter(createRecordingDb().db, 't-1'), null);
  });
});

describe('checkClaim', () => {
  it('says what the claim lacks to be sent', async () => {
    const ready = await checkClaim(createRecordingDb((q) => rows(q.sql)).db, 't-1', 'c-1');
    assert.deepEqual(ready?.issues, []);
    const unprofiled = await checkClaim(
      createRecordingDb((q) => (q.sql.includes('from "claims"') ? [CLAIM_ROW] : [])).db,
      't-1',
      'c-1'
    );
    assert.deepEqual(unprofiled?.issues, ['Add a billing profile in Settings']);
    assert.equal(await checkClaim(createRecordingDb().db, 't-1', 'c-1'), null);
  });
});

describe('cancelStaleReviews', () => {
  it('cancels the open reviews of the encounter, but not the run asking', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "r"."id"') ? [{ id: 'run-2' }] : []
    );
    const jobs: unknown[] = [];
    const boss: RunQueueClient = { insert: async (_, batch) => void jobs.push(...batch) };
    assert.equal(await cancelStaleReviews(db, boss, 't-1', 'e-1', 'run-1'), 1);
    const [select] = queries;
    assert.match(select?.sql ?? '', /r\.inputs ->> 'encounterId' = \$\d+/);
    assert.match(select?.sql ?? '', /"r"\."id" <> \$\d+$/);
    assert.ok(select?.parameters.includes('claims:approve'));
    assert.deepEqual(
      jobs.map((j) => (j as { data: unknown }).data),
      [{ runId: 'run-2', command: { type: 'cancel' } }]
    );
    queries.length = 0;
    await cancelStaleReviews(db, boss, 't-1', 'e-1', null);
    assert.ok(!queries[0]?.sql.includes('<>'));
  });
});

describe('replaceClaimParts', () => {
  it('replaces the lines, payers and diagnoses in order, and inserts no empty list', async () => {
    const { db, queries } = createRecordingDb();
    await replaceClaimParts(db, 't-1', 'c-1', {
      lines: [{ code: 'A0427', modifiers: ['RH'], units: 1, unitCents: 1, totalCents: 1 }],
      coverages: [],
      diagnoses: ['R079', 'I10']
    });
    assert.deepEqual(
      queries.map((q) => q.sql.split(' (')[0]),
      [
        'delete from "claim_lines" where "claim_id" = $1',
        'delete from "claim_coverages" where "claim_id" = $1 and "position" > $2',
        'delete from "claim_diagnoses" where "claim_id" = $1',
        'insert into "claim_lines"',
        'insert into "claim_diagnoses"'
      ]
    );
    assert.deepEqual(queries[4]?.parameters, ['c-1', 1, 'R079', 'c-1', 2, 'I10']);
  });

  it('keeps the payers that already decided the claim, and numbers the rest after them', async () => {
    const { db, queries } = createRecordingDb();
    const payer = {
      payerId: null,
      payerName: 'Medicare',
      memberId: 'M1',
      groupId: null,
      relationship: '18' as const,
      insuredFirstName: null,
      insuredLastName: null
    };
    await replaceClaimParts(
      db,
      't-1',
      'c-1',
      { lines: [], diagnoses: [], coverages: [payer, { ...payer, payerName: 'Blue Plan' }] },
      1
    );
    assert.deepEqual(queries[1]?.parameters, ['c-1', 1]);
    const inserted = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.deepEqual(inserted?.parameters.slice(0, 4), ['t-1', 'c-1', 2, 'Blue Plan']);
  });
});
