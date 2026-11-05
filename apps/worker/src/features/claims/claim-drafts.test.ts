import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DraftClaim, NewClaim } from '@ugula/billing';
import { COMPLETE_DOCUMENTATION } from '@ugula/billing/testing';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunJob, RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createDraftStore } from './claim-drafts.ts';

const jobs: RunJob[] = [];

const boss: RunQueueClient = {
  insert: async (_, inserted) => {
    jobs.push(...inserted.map((j) => j.data as RunJob));
  }
};

const ID = '0195f2a4-0000-7000-8000-000000000001';

const OLD_RUN = '0195f2a4-0000-7000-8000-0000000000a1';

const owned = { id: ID, agency_id: 't-1' };

const place = { addressLine: null, city: null, state: null, postalCode: null };

const claim: NewClaim = {
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  tripType: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  deceased: false,
  nonCoveredMiles: null,
  lines: [
    { code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 },
    { code: 'A0425', units: 12.4, unitCents: 1_550, totalCents: 19_220 }
  ],
  totalCents: 114_220,
  coverages: [
    {
      payer: 'Medicare',
      payerId: null,
      payerCode: 'MCR',
      memberId: 'M1',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    },
    {
      payer: 'BCBS',
      payerId: '0195f2a4-0000-7000-8000-00000000000b',
      payerCode: null,
      memberId: null,
      groupId: 'G9',
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    }
  ],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, ...place, state: 'IL' },
    destination: { name: 'St. Mary', ...place },
    diagnoses: ['R079', 'I10'],
    originDestination: 'SH',
    documentation: COMPLETE_DOCUMENTATION
  },
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json'
};

const draft: DraftClaim = {
  pcrNumber: 'PCR-1',
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json',
  claimId: null
};

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "agency_id" from "claims"');

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createDraftStore', () => {
  it('opens a draft claim without a patient, linked to its source report and its run', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"') ? [{ id: ID }] : []
    );
    assert.deepEqual(await createDraftStore(db, boss).openDraft('r1', 'r1:s:open:0', draft), {
      id: ID,
      duplicate: false
    });
    const [insert] = sqlOf(queries, 'insert into "claims"');
    assert.ok(insert?.sql.includes('on conflict do nothing'));
    assert.ok(
      insert?.sql.includes(
        '(select "r"."id" from "import_reports" as "r" inner join "imports" as "i" on "i"."id" = "r"."import_id" where r.report ->> \'key\' = $'
      )
    );
    assert.ok(insert?.parameters.includes('imports/t-1/a/f.xml.reports/00000.json'));
    assert.ok(insert?.parameters.includes('PCR-1'));
    assert.ok(!insert?.sql.includes('"level"') && !insert?.sql.includes('"patient_id"'));
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.ok(link?.sql.includes('select "id", $1::uuid as "claim_id" from "workflow_runs"'));
    assert.ok(link?.sql.endsWith('on conflict ("run_id") do nothing'));
    assert.deepEqual(link?.parameters.slice(0, 2), [ID, 'r1']);
  });

  it('assigns a patient of the same agency to a draft, or again to the same patient', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update') ? [{}] : []
    );
    await createDraftStore(db, boss).assignPatient('r1', ID, 'k', ID);
    const update = queries.at(-1);
    assert.ok(
      update?.sql.startsWith(
        'update "claims" set "patient_id" = (select "id" from "patients" where "id" = $1 and "agency_id" = $2)'
      )
    );
    assert.ok(update?.sql.includes('exists (select "id" from "patients"'));
    assert.ok(update?.sql.includes('or "patient_id" = (select "id" from "patients"'));
    assert.ok(update?.parameters.includes('draft'));
  });

  it('refuses unknown patients, claims that are no longer drafts and unknown claims', async () => {
    const { db } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    const store = createDraftStore(db, boss);
    await assert.rejects(() => store.assignPatient('r1', ID, 'k', ID), /is not a draft/);
    await assert.rejects(() => store.assignPatient('r1', ID, 'k', 'nope'), /does not exist/);
    const none = createDraftStore(createRecordingDb().db, boss);
    await assert.rejects(() => none.assignPatient('r1', ID, 'k', ID), /Claim .* does not exist/);
    await assert.rejects(
      () => none.assignPatient('r1', 'bad', 'k', ID),
      /Claim bad does not exist/
    );
  });

  it('reopens a claim from a report as a draft and cancels the runs still working it', async () => {
    jobs.length = 0;
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.includes('with old as') ? [{ id: OLD_RUN }] : []
    );
    assert.deepEqual(
      await createDraftStore(db, boss).openDraft('r1', 'r1:s:open:0', { ...draft, claimId: ID }),
      { id: ID, duplicate: false }
    );
    const [reopen] = queries.filter((q) => q.sql.includes('with old as'));
    assert.ok(reopen?.sql.includes("status = 'draft'"));
    assert.ok(reopen?.sql.includes('cycle_run_id = null'));
    assert.ok(
      reopen?.sql.includes('import_report_id = coalesce((select "r"."id" from "import_reports"')
    );
    assert.ok(reopen?.sql.includes('r.id in (select cr.run_id from claim_runs cr'));
    assert.ok(reopen?.sql.includes('or r.id = (select cycle_run_id from old)'));
    assert.ok(reopen?.parameters.includes('suspended') && reopen.parameters.includes('r1'));
    assert.equal(sqlOf(queries, 'insert into "claims"').length, 0);
    assert.equal(sqlOf(queries, 'insert into "claim_runs"').length, 1);
    assert.deepEqual(jobs, [{ runId: OLD_RUN, command: { type: 'cancel' } }]);
    await assert.rejects(
      createDraftStore(createRecordingDb().db, boss).openDraft('r1', 'k', {
        ...draft,
        claimId: ID
      }),
      /does not exist/
    );
  });

  it('returns the existing claim on a replayed step and flags another run as a duplicate', async () => {
    const lookup = (sourceKey: string) =>
      createRecordingDb((q) =>
        q.sql.startsWith('select "id", "source_key" from "claims"')
          ? [{ id: ID, source_key: sourceKey }]
          : []
      );
    const replay = lookup('r1:s:open:0');
    assert.deepEqual(
      await createDraftStore(replay.db, boss).openDraft('r1', 'r1:s:open:0', draft),
      {
        id: ID,
        duplicate: false
      }
    );
    const query = sqlOf(replay.queries, 'select "id", "source_key" from "claims"')[0];
    assert.ok(query?.sql.includes('("source_key" = $2 or "pcr_number" = $3)'));
    assert.ok(query?.sql.endsWith('order by source_key = $4 desc'));
    const other = lookup('other-run:s:open:0');
    assert.deepEqual(await createDraftStore(other.db, boss).openDraft('r1', 'r1:s:open:0', draft), {
      id: ID,
      duplicate: true
    });
    assert.equal(sqlOf(other.queries, 'insert into "claim_runs"').length, 1);
  });

  it('fills a draft with its trip type, lines, coverages and diagnoses and keeps it a draft', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    await createDraftStore(db, boss).saveClaim('r1', ID, 'k', claim);
    const [update] = sqlOf(queries, 'update "claims"');
    assert.ok(update?.sql.endsWith('where "id" = $47 and "status" = $48'));
    assert.ok(!update?.parameters.includes('needs_review'));
    assert.ok(update?.parameters.includes('emergency') && update.parameters.includes('ALS1'));
    assert.ok(update?.parameters.includes('2026-10-01'));
    assert.ok(update?.parameters.includes('S') && update.parameters.includes('H'));
    assert.ok(update?.parameters.includes('St. Mary'));
    const [cleared] = sqlOf(queries, 'with "lines" as (delete from "claim_lines"');
    assert.ok(cleared?.sql.includes('"coverages" as (delete from "claim_coverages"'));
    assert.ok(cleared?.sql.includes('delete from "claim_diagnoses"'));
    const [lines] = sqlOf(queries, 'insert into "claim_lines"');
    assert.deepEqual(lines?.parameters, [
      ID,
      1,
      'A0427',
      1,
      95_000,
      95_000,
      ID,
      2,
      'A0425',
      12.4,
      1_550,
      19_220
    ]);
    const [coverages] = sqlOf(queries, 'insert into "claim_coverages"');
    assert.ok(coverages?.sql.includes('(select "id" from "payers" where "agency_id" ='));
    assert.ok(coverages?.parameters.includes('medicare') && coverages.parameters.includes('MCR'));
    assert.ok(coverages?.sql.includes('and "id" = $'));
    assert.ok(coverages?.parameters.includes('0195f2a4-0000-7000-8000-00000000000b'));
    assert.ok(!coverages?.parameters.includes('bcbs'));
    const [diagnoses] = sqlOf(queries, 'insert into "claim_diagnoses"');
    assert.deepEqual(diagnoses?.parameters, [ID, 1, 'R079', ID, 2, 'I10']);
  });

  it('saves only drafts, and skips optional rows it does not have', async () => {
    const saved = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createDraftStore(saved.db, boss).saveClaim('r1', ID, 'k', claim);
    assert.equal(sqlOf(saved.queries, 'with "lines"').length, 0);
    const bare = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    await createDraftStore(bare.db, boss).saveClaim('r1', ID, 'k', {
      ...claim,
      coverages: [],
      details: { ...claim.details, diagnoses: [] }
    });
    assert.equal(sqlOf(bare.queries, 'insert into "claim_coverages"').length, 0);
    assert.equal(sqlOf(bare.queries, 'insert into "claim_diagnoses"').length, 0);
  });
});
