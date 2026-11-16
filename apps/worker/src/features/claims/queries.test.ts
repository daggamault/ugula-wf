import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type {
  ClaimPatch,
  ClaimStore,
  Clearinghouse,
  DraftClaim,
  ManualPayment,
  NewClaim
} from '@ugula/billing';
import { COMPLETE_DOCUMENTATION, sampleSubmitter } from '@ugula/billing/testing';
import type { Db } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunJob, RunQueueClient } from '@ugula/run-queue';
import type { BlobStore } from '@ugula/storage';
import type { CompiledQuery } from 'kysely';
import {
  agencyClaim,
  createClaimStore,
  createClaimTaskStore,
  createCycleStore,
  createDraftStore,
  createFacilityStore,
  createLedgerStore,
  createStatementStore,
  createSubmissionStore,
  documentKey,
  linkClaimRun,
  planCoverages,
  replaceClaimRows,
  statementKey,
  uploadsOf
} from './queries.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

describe('claim scope', () => {
  it('finds a claim only in the run agency and refuses unknown or malformed ids', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: ID, agency_id: 't-1' }]);
    assert.deepEqual(await agencyClaim(db, 'r1', ID), { id: ID, agency_id: 't-1' });
    assert.ok(queries[0]?.sql.includes('"agency_id" = (select "agency_id" from "workflow_runs"'));
    assert.deepEqual(queries[0]?.parameters, [ID, 'r1']);
    await assert.rejects(agencyClaim(db, 'r1', 'bad'), /Claim bad does not exist/);
    assert.equal(queries.length, 1);
    await assert.rejects(agencyClaim(createRecordingDb().db, 'r1', ID), /does not exist/);
  });

  it('links a run of the claim agency to the claim once', async () => {
    const { db, queries } = createRecordingDb();
    await linkClaimRun(db, 'r1', ID);
    const [link] = queries;
    assert.ok(link?.sql.startsWith('insert into "claim_runs" ("agency_id", "run_id", "claim_id")'));
    assert.ok(
      link?.sql.includes('select "agency_id", "id", $1::uuid as "claim_id" from "workflow_runs"')
    );
    assert.ok(link?.sql.endsWith('on conflict ("run_id") do nothing'));
    assert.deepEqual(link?.parameters, [ID, 'r1', ID]);
  });
});

const place = { addressLine: null, city: null, state: null, postalCode: null };

const claim: NewClaim = {
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  classification: 'emergency',
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

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('claim coverages', () => {
  it('drops repeated payers by name and member ID, and repeated diagnosis codes', async () => {
    const { db, queries } = createRecordingDb();
    const [medicare] = claim.coverages;
    assert.ok(medicare);
    await replaceClaimRows(db, 'r1', ID, {
      ...claim,
      lines: [],
      coverages: [
        medicare,
        { ...medicare, payer: 'MEDICARE', memberId: 'm1', payerCode: 'DUP' },
        { ...medicare, memberId: 'M2' }
      ],
      details: { ...claim.details, diagnoses: ['R079', 'I10', 'R079'] }
    });
    assert.equal(sqlOf(queries, 'insert into "claim_lines"').length, 0);
    const [coverages] = sqlOf(queries, 'insert into "claim_coverages"');
    assert.ok(coverages?.parameters.includes('M1') && coverages.parameters.includes('M2'));
    assert.ok(!coverages?.parameters.includes('DUP'));
    const [diagnoses] = sqlOf(queries, 'insert into "claim_diagnoses"');
    assert.deepEqual(diagnoses?.parameters, [ID, 1, 'R079', ID, 2, 'I10']);
  });

  it('keeps payers with billing activity by name and member ID, then by name, and moves the rest last', () => {
    const [medicare, bcbs] = claim.coverages;
    assert.ok(medicare && bcbs);
    const active = [
      { id: 'a', payer_name: 'BCBS', member_id: null },
      { id: 'b', payer_name: 'MEDICARE', member_id: 'old' },
      { id: 'c', payer_name: 'Medicare', member_id: 'm1' },
      { id: 'd', payer_name: 'Aetna', member_id: 'X' }
    ];
    assert.deepEqual(
      planCoverages(active, [
        medicare,
        { ...medicare, memberId: 'M2' },
        { ...bcbs, payer: 'Cigna' }
      ]),
      {
        rows: [
          { coverage: medicare, position: 1, id: 'c' },
          { coverage: { ...medicare, memberId: 'M2' }, position: 2, id: 'b' },
          { coverage: { ...bcbs, payer: 'Cigna' }, position: 3, id: null }
        ],
        trailing: [
          { id: 'a', position: 4 },
          { id: 'd', position: 5 }
        ]
      }
    );
  });

  it('moves active payers the report dropped after the rest, and never links a non-UUID payer id', async () => {
    const OLD = '0195f2a4-0000-7000-8000-0000000000e2';
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('with "lines"') ? [{ id: OLD, payer_name: 'Aetna', member_id: null }] : []
    );
    const [, bcbs] = claim.coverages;
    assert.ok(bcbs);
    await replaceClaimRows(db, 'r1', ID, {
      ...claim,
      coverages: [{ ...bcbs, payerId: 'not-a-uuid' }]
    });
    const [moved] = sqlOf(queries, '\n    update claim_coverages cc set position = v.position');
    assert.deepEqual(moved?.parameters, [OLD, 2, ID]);
    const [added] = sqlOf(queries, 'insert into "claim_coverages"');
    assert.ok(added?.sql.includes('where "agency_id" = '));
    assert.ok(added?.sql.includes('and "id" = $'));
    assert.deepEqual(added?.parameters, [
      ID,
      'r1',
      1,
      'BCBS',
      'r1',
      null,
      null,
      null,
      'G9',
      '18',
      null,
      null
    ]);
  });

  it('reworks the rows without deleting payers that have billing activity', async () => {
    const KEPT = '0195f2a4-0000-7000-8000-0000000000e1';
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('with "lines"')
        ? [{ id: KEPT, payer_name: 'Medicare', member_id: 'M0' }]
        : []
    );
    await replaceClaimRows(db, 'r1', ID, claim);
    const [cleared] = sqlOf(queries, 'with "lines" as (delete from "claim_lines"');
    assert.ok(
      cleared?.sql.includes(
        '"coverages" as (delete from "claim_coverages" where "claim_id" = $2 and not exists (select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "claim_coverages"."id"))'
      )
    );
    const [kept] = sqlOf(
      queries,
      '\n    update claim_coverages cc set\n      position = v.position'
    );
    assert.ok(
      kept?.sql.includes('eligibility = case when cc.payer_id is not distinct from v.payer_id')
    );
    assert.deepEqual(kept?.parameters.slice(0, 3), [KEPT, 1, 'Medicare']);
    assert.ok(kept?.parameters.includes('M1'));
    const [added] = sqlOf(queries, 'insert into "claim_coverages"');
    assert.ok(added?.parameters.includes('0195f2a4-0000-7000-8000-00000000000b'));
    assert.ok(!added?.parameters.includes('MCR'));
  });
});

const jobs: RunJob[] = [];

const boss: RunQueueClient = {
  insert: async (_, inserted) => {
    jobs.push(...inserted.map((j) => j.data as RunJob));
  }
};

const OLD_RUN = '0195f2a4-0000-7000-8000-0000000000a1';

const owned = { id: ID, agency_id: 't-1' };

const draft: DraftClaim = {
  pcrNumber: 'PCR-1',
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json',
  claimId: null
};

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "agency_id" from "claims"');

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
        '(select "r"."id" from "import_reports" as "r" where "r"."agency_id" = (select "agency_id" from "workflow_runs"'
      )
    );
    assert.ok(insert?.parameters.includes('imports/t-1/a/f.xml.reports/00000.json'));
    assert.ok(insert?.parameters.includes('PCR-1'));
    assert.ok(!insert?.sql.includes('"level"') && !insert?.sql.includes('"patient_id"'));
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.ok(
      link?.sql.includes('select "agency_id", "id", $1::uuid as "claim_id" from "workflow_runs"')
    );
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

  it('fills a draft with its classification, lines, coverages and diagnoses and keeps it a draft', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    await createDraftStore(db, boss).saveClaim('r1', ID, 'k', claim);
    const [update] = sqlOf(queries, 'update "claims"');
    assert.ok(update?.sql.endsWith('where "id" = $48 and "status" = $49'));
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

  it('opens a draft without a source report or PCR number, matching a replay by its step only', async () => {
    const bare = { pcrNumber: null, reportKey: null, claimId: null };
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "source_key" from "claims"')
        ? [{ id: ID, source_key: 'r1:s:open:0' }]
        : []
    );
    assert.deepEqual(await createDraftStore(db, boss).openDraft('r1', 'r1:s:open:0', bare), {
      id: ID,
      duplicate: false
    });
    const [insert] = sqlOf(queries, 'insert into "claims"');
    assert.ok(!insert?.sql.includes('import_reports'));
    assert.deepEqual(insert?.parameters, ['r1', null, null, 'r1:s:open:0']);
    const [lookup] = sqlOf(queries, 'select "id", "source_key" from "claims"');
    assert.ok(lookup?.sql.includes('and "source_key" = $2 order by source_key = $3 desc'));
    assert.deepEqual(lookup?.parameters, ['r1', 'r1:s:open:0', 'r1:s:open:0']);
  });

  it('reopens a claim keeping its source report when the new one has none', async () => {
    const { db, queries } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createDraftStore(db, boss).openDraft('r1', 'k', {
      pcrNumber: 'PCR-1',
      reportKey: null,
      claimId: ID
    });
    const [reopen] = queries.filter((q) => q.sql.includes('with old as'));
    assert.ok(reopen?.sql.includes('import_report_id = coalesce(null::uuid, import_report_id)'));
    assert.ok(!reopen?.sql.includes('import_reports'));
  });

  it('saves no origin or destination code when the trip has none', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    await createDraftStore(db, boss).saveClaim('r1', ID, 'k', {
      ...claim,
      details: { ...claim.details, originDestination: null }
    });
    const [update] = sqlOf(queries, 'update "claims"');
    const at = (column: string) =>
      update?.parameters[Number(update.sql.match(new RegExp(`"${column}" = \\$(\\d+)`))?.[1]) - 1];
    assert.deepEqual([at('origin_code'), at('destination_code')], [null, null]);
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

const CYCLE = '0195f2a4-0000-7000-8000-0000000000c1';

describe('createCycleStore', () => {
  it('writes the cycle status only while the claim signals match the ledger it came from', async () => {
    let received = 4;
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.includes('with current as') ? [{ received }] : []
    );
    const store = createCycleStore(db, boss);
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 4), 'set');
    const at = queries.findIndex((q) => q.sql.includes('with current as'));
    const write = queries[at];
    const locked = queries.findIndex((q) => q.sql.endsWith('for update'));
    assert.ok(locked >= 0 && locked < at);
    assert.ok(write?.sql.includes('(select received from current) = $'));
    assert.ok(write?.sql.includes('and status <> $'));
    assert.deepEqual(
      write?.parameters.filter((x) => typeof x === 'string' && x !== ID),
      [
        't-1',
        `claim:${ID}`,
        'submitted',
        'submitted',
        'draft',
        'paid',
        'written_off',
        'collections',
        'void'
      ]
    );
    assert.ok(write?.parameters.includes(4));
    received = 5;
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 4), 'stale');
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 5), 'set');
  });

  it('treats a claim that never had a signal as seen at zero', async () => {
    const { db } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    const store = createCycleStore(db, boss);
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 0), 'set');
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 1), 'stale');
  });

  it('reads no claim check for a run that no longer exists', async () => {
    const { db, queries } = createRecordingDb();
    assert.equal(await createCycleStore(db, boss).claimCheck('r1', ID), null);
    assert.deepEqual(
      queries.map((q) => q.parameters),
      [['r1']]
    );
  });

  it('reads a claim check for the run agency', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"') ? [{ agency_id: 't-1' }] : []
    );
    const store = createCycleStore(db, boss);
    assert.equal(await store.claimCheck('r1', ID), null);
    assert.ok(
      queries.some((q) => q.sql.includes('from "claims" as "c"') && q.parameters.includes('t-1'))
    );
    assert.equal(await store.claimCheck('r1', 'bad'), null);
  });

  it('applies a claim patch with an edit event once per step and signals the claim', async () => {
    jobs.length = 0;
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.startsWith('insert into "claim_events"')
          ? [{ id: 'e1' }]
          : q.sql.startsWith('select "id", state')
            ? [{ id: CYCLE, wait_id: 'w1' }]
            : []
    );
    const patch: ClaimPatch = {
      serviceDate: '2026-10-02',
      documentation: null,
      classification: null,
      level: null,
      emergency: null,
      loadedMiles: null,
      deceased: null,
      nonCoveredMiles: null,
      diagnoses: null,
      pickup: null,
      destination: null,
      originDestination: null,
      patientAddress: null,
      coverage: {
        coverageId: 'cov-1',
        payerId: null,
        memberId: 'M9',
        relationship: null,
        insuredFirstName: null,
        insuredLastName: null,
        remove: false
      },
      newCoverage: null,
      lines: null,
      note: 'Fixed the date'
    };
    await createCycleStore(db, boss).patchClaim('r1', ID, 'r1:s:patch:0', patch);
    const [edited] = sqlOf(queries, 'insert into "claim_events"');
    assert.ok(
      edited?.parameters.includes('edited') && edited.parameters.includes('Fixed the date')
    );
    assert.ok(edited?.parameters.includes('r1:s:patch:0'));
    assert.ok(queries.some((q) => q.sql.startsWith('update "claims" set "service_date"')));
    assert.ok(
      queries.some(
        (q) => q.sql.includes('update claim_coverages cc') && q.parameters.includes('M9')
      )
    );
    const [signal] = sqlOf(queries, 'insert into "signals"');
    assert.ok(signal?.parameters.includes(`claim:${ID}`));
    assert.deepEqual(
      jobs.map((j) => [j.runId, j.command.type]),
      [[CYCLE, 'resume']]
    );
    jobs.length = 0;
    const replay = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createCycleStore(replay.db, boss).patchClaim('r1', ID, 'r1:s:patch:0', patch);
    assert.equal(sqlOf(replay.queries, 'insert into "signals"').length, 0);
    assert.equal(sqlOf(replay.queries, 'update').length, 0);
    assert.deepEqual(jobs, []);
  });

  it('touches no payer when the patch has no coverage', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('insert into "claim_events"') ? [{ id: 'e1' }] : []
    );
    await createCycleStore(db, boss).patchClaim('r1', ID, 'r1:s:patch:1', {
      serviceDate: '2026-10-03',
      documentation: null,
      classification: null,
      level: null,
      emergency: null,
      loadedMiles: null,
      deceased: null,
      nonCoveredMiles: null,
      diagnoses: null,
      pickup: null,
      destination: null,
      originDestination: null,
      patientAddress: null,
      coverage: null,
      newCoverage: null,
      lines: null,
      note: ''
    });
    assert.ok(queries.some((q) => q.sql.startsWith('update "claims" set "service_date"')));
    assert.ok(!queries.some((q) => q.sql.includes('claim_coverages')));
    assert.equal(sqlOf(queries, 'insert into "signals"').length, 1);
  });

  it('links a claim to a cycle run of the same agency only', async () => {
    const attach = (free: boolean) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.startsWith('select "id" from "workflow_runs"')
            ? [{ id: CYCLE }]
            : q.sql.startsWith('update "claims"') && free
              ? [{}]
              : []
      );
    const { db, queries } = attach(true);
    await createCycleStore(db, boss).attachCycle('r1', ID, 'k', CYCLE);
    const run = queries.find((q) => q.sql.startsWith('select "id" from "workflow_runs"'));
    assert.ok(run?.parameters.includes('t-1'));
    const [update] = sqlOf(queries, 'update "claims"');
    assert.deepEqual(update?.parameters.slice(0, 3), [CYCLE, 'draft', 'needs_review']);
    assert.ok(update?.sql.includes('"status" = case when c.status = $2 then $3 else c.status end'));
    assert.ok(update?.sql.includes('"c"."cycle_run_id" is null'));
    assert.ok(update?.sql.includes('not exists (select "r"."id" from "workflow_runs" as "r"'));
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.deepEqual(link?.parameters.slice(0, 2), [ID, CYCLE]);
    const [signal] = sqlOf(queries, 'insert into "signals"');
    assert.ok(signal?.parameters.includes(`claim:${ID}`));
    const busy = attach(false);
    await assert.rejects(
      () => createCycleStore(busy.db, boss).attachCycle('r1', ID, 'k', CYCLE),
      /already has an active payer cycle/
    );
    assert.equal(sqlOf(busy.queries, 'insert into "claim_runs"').length, 0);
    assert.equal(sqlOf(busy.queries, 'insert into "signals"').length, 0);
    const missing = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    const store = createCycleStore(missing.db, boss);
    await assert.rejects(() => store.attachCycle('r1', ID, 'k', CYCLE), /does not exist/);
    await assert.rejects(() => store.attachCycle('r1', ID, 'k', 'cycle-1'), /does not exist/);
    assert.equal(sqlOf(missing.queries, 'update').length, 0);
  });

  it('closes under a row lock, as paid when nothing is owed, and only open claims', async () => {
    const close = async (
      locked: { status: string; balance_cents: number },
      requested: 'written_off' | 'void' = 'written_off'
    ) => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.includes('for update')
          ? [{ status: locked.status }]
          : q.sql.includes('from "claim_balances"')
            ? [{ balance_cents: locked.balance_cents }]
            : ownedClaim(q)
              ? [owned]
              : []
      );
      await createCycleStore(db, boss).closeClaim('r1', ID, 'k2', requested);
      return queries;
    };
    const owed = await close({ status: 'balance_review', balance_cents: 500 });
    const lockAt = owed.findIndex((q) => q.sql.endsWith('for update'));
    const balanceAt = owed.findIndex((q) => q.sql.includes('from "claim_balances"'));
    assert.ok(lockAt >= 0 && balanceAt > lockAt);
    assert.deepEqual(owed.find((q) => q.sql.startsWith('update'))?.parameters[0], 'written_off');
    const settled = await close({ status: 'balance_review', balance_cents: 0 });
    assert.deepEqual(settled.find((q) => q.sql.startsWith('update'))?.parameters[0], 'paid');
    const voided = await close({ status: 'draft', balance_cents: 0 }, 'void');
    assert.deepEqual(voided.find((q) => q.sql.startsWith('update'))?.parameters[0], 'void');
    const forgotten = owed.find((q) => q.sql.startsWith('delete from "signals"'));
    assert.ok(forgotten?.parameters.includes(`claim:${ID}`));
    const done = await close({ status: 'paid', balance_cents: 0 });
    assert.equal(
      done.some((q) => q.sql.startsWith('update')),
      false
    );
  });

  it('cancels the claim cycle and open claim tasks, never the closing run or its parents', async () => {
    jobs.length = 0;
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('for update')
        ? [{ status: 'needs_review' }]
        : q.sql.includes('from "claim_balances"')
          ? [{ balance_cents: 500 }]
          : q.sql.includes('with recursive closing')
            ? [{ id: CYCLE }, { id: 'chase-1' }]
            : ownedClaim(q)
              ? [owned]
              : []
    );
    await createCycleStore(db, boss).closeClaim('r1', ID, 'k2', 'void');
    const others = queries.find((q) => q.sql.includes('with recursive closing'));
    assert.ok(others?.sql.includes('r.id not in (select id from closing)'));
    assert.deepEqual(others?.parameters.slice(0, 1), ['r1']);
    assert.deepEqual(
      jobs.map((j) => [j.runId, j.command.type]),
      [
        [CYCLE, 'cancel'],
        ['chase-1', 'cancel']
      ]
    );
    jobs.length = 0;
  });

  it('links a run to a claim of its own agency', async () => {
    const { db, queries } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createCycleStore(db, boss).linkRun('r1', ID);
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.deepEqual(link?.parameters.slice(0, 2), [ID, 'r1']);
    await assert.rejects(
      () => createCycleStore(createRecordingDb().db, boss).linkRun('r1', ID),
      /does not exist/
    );
  });
});

describe('createFacilityStore', () => {
  it('bills a claim to a facility of its own agency once per step, and back to the payers', async () => {
    const FACILITY_ID = '0195f2a4-0000-7000-8000-0000000000f1';
    const respond = ({ recorded = false, status = 'needs_review', known = true } = {}) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.includes('for update')
            ? [{ id: ID, status, patient_id: null }]
            : q.sql.startsWith('select "id" from "claim_events"') && recorded
              ? [{ id: 'e0' }]
              : q.sql.startsWith('select "id" from "facilities"') && known
                ? [{ id: FACILITY_ID }]
                : []
      );
    const { db, queries } = respond();
    await createFacilityStore(db, boss).setResponsibility('r1', ID, 'k', {
      party: 'facility',
      facilityId: FACILITY_ID,
      note: 'Contract with Oak Manor'
    });
    assert.ok(queries.some((q) => q.sql.endsWith('for update')));
    const [lookup] = sqlOf(queries, 'select "id" from "facilities"');
    assert.deepEqual(lookup?.parameters, [FACILITY_ID, 't-1']);
    const [event] = sqlOf(queries, 'insert into "claim_events"');
    assert.ok(event?.parameters.includes('responsibility'));
    assert.ok(event?.parameters.includes('Contract with Oak Manor'));
    const [update] = sqlOf(queries, 'update "claims"');
    assert.deepEqual(update?.parameters.slice(0, 1), [FACILITY_ID]);
    assert.equal(sqlOf(queries, 'insert into "signals"').length, 1);
    const back = respond();
    await createFacilityStore(back.db, boss).setResponsibility('r1', ID, 'k', {
      party: 'payer',
      facilityId: null,
      note: 'Billed to the payers'
    });
    const [reset] = sqlOf(back.queries, 'update "claims"');
    assert.deepEqual(reset?.parameters, [null, ID]);
    const facility = { party: 'facility' as const, facilityId: FACILITY_ID, note: '' };
    for (const [opts, fault] of [
      [{ known: false }, /is not in the facility directory/],
      [{ status: 'paid' }, /already closed/]
    ] as const) {
      const refused = respond(opts);
      await assert.rejects(
        () => createFacilityStore(refused.db, boss).setResponsibility('r1', ID, 'k', facility),
        fault
      );
      assert.equal(sqlOf(refused.queries, 'update "claims"').length, 0);
    }
    await assert.rejects(
      () =>
        createFacilityStore(respond().db, boss).setResponsibility('r1', ID, 'k', {
          party: 'facility',
          facilityId: null,
          note: ''
        }),
      /Choose the facility/
    );
    const replay = respond({ recorded: true, status: 'paid' });
    await createFacilityStore(replay.db, boss).setResponsibility('r1', ID, 'k', {
      party: 'payer',
      facilityId: null,
      note: ''
    });
    assert.equal(sqlOf(replay.queries, 'update "claims"').length, 0);
  });

  it('lists the facilities of the run agency with a known kind', async () => {
    const { db, queries } = createRecordingDb(() => [
      { id: 'f1', name: 'Oak Manor', kind: 'snf', contract: true },
      { id: 'f2', name: 'Odd', kind: 'spa', contract: false }
    ]);
    assert.deepEqual(await createFacilityStore(db, boss).facilityDirectory('r1'), [
      { id: 'f1', name: 'Oak Manor', kind: 'snf', contract: true }
    ]);
    assert.ok(queries.at(-1)?.sql.endsWith('order by "name"'));
  });
});

describe('createLedgerStore', () => {
  it('notes revisions with the new report and returns the status and the report it was billed from', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.startsWith('select "c"."status"')
          ? [{ status: 'submitted', bucket: 'ugula', key: 'imports/t-1/f.xml.reports/00000.json' }]
          : []
    );
    const store = createLedgerStore(db);
    const report = { bucket: 'ugula', key: 'imports/t-1/g.xml.reports/00000.json' };
    assert.deepEqual(await store.noteRevision('r1', ID, 'k1', report), {
      status: 'submitted',
      previous: { bucket: 'ugula', key: 'imports/t-1/f.xml.reports/00000.json' }
    });
    const [insert] = sqlOf(queries, 'insert into "claim_events"');
    assert.ok(insert?.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.parameters.includes('revised'));
    assert.ok(insert?.parameters.includes(JSON.stringify(report)));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    for (const key of ['imports/t-2/g.json', 'imports/t-1/../t-2/g.json']) {
      await assert.rejects(
        () => store.noteRevision('r1', ID, 'k2', { bucket: 'ugula', key }),
        /not one of this agency's imports/
      );
    }
  });

  it('reads the ledger by coverage in billing order and refuses other agencies or bad ids', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('left join "patients"')
        ? [
            {
              id: ID,
              total_cents: 95_000,
              pcr_number: 'PCR-1',
              first_name: 'Jane',
              last_name: 'Doe',
              facility_id: null,
              service_date: '2026-01-01',
              pickup_state: 'IL',
              received: 4,
              pending_review: true
            }
          ]
        : q.sql.includes('from "claim_coverages"')
          ? [{ id: 'cov-1', payer: 'Medicare' }]
          : [
              {
                kind: 'submitted',
                coverage_id: 'cov-1',
                paid_cents: 0,
                adjusted_cents: 0,
                payer_claim_number: null,
                paid_on: null,
                adjustments: [],
                remarks: ['MA18'],
                lines: [],
                note: 'ICN 1',
                route: null,
                created_at: new Date('2026-01-01T00:00:00.000Z')
              }
            ]
    );
    const store = createLedgerStore(db);
    assert.deepEqual(await store.ledger('r1', ID), {
      totalCents: 95_000,
      facilityId: null,
      serviceDate: '2026-01-01',
      pickupState: 'IL',
      pendingReview: true,
      signalsSeen: 4,
      reference: 'PCR-1 · Jane Doe',
      coverages: [{ id: 'cov-1', payer: 'Medicare' }],
      events: [
        {
          kind: 'submitted',
          coverageId: 'cov-1',
          paidCents: 0,
          adjustedCents: 0,
          payerClaimNumber: null,
          paidOn: null,
          adjustments: [],
          remarks: ['MA18'],
          lines: [],
          note: 'ICN 1',
          route: null,
          at: '2026-01-01T00:00:00.000Z'
        }
      ]
    });
    const [head] = queries;
    assert.ok(head?.sql.includes('(select "s"."received" from "signals" as "s"'));
    assert.deepEqual(head?.parameters.slice(0, 4), [
      `claim:${ID}`,
      'open',
      'billing.review-payer-file-line',
      ID
    ]);
    assert.ok(head?.sql.includes('exists (select "t"."id" from "tasks" as "t"'));
    assert.equal(queries.length, 3);
    const coverages = queries.find((q) => q.sql.includes('from "claim_coverages"'));
    assert.ok(coverages?.sql.includes('coalesce(dp.name, cc.payer_name) as "payer"'));
    assert.ok(coverages?.sql.endsWith('order by "cc"."position"'));
    const events = queries.find((q) => q.sql.includes('from "claim_events" as "e"'));
    assert.ok(events?.sql.endsWith('order by "e"."created_at", "e"."id"'));
    assert.ok(events?.sql.includes('from claim_event_adjustments a where a.event_id = e.id'));
    assert.ok(events?.sql.includes('from claim_event_remarks r where r.event_id = e.id'));
    assert.ok(events?.sql.includes('from claim_event_lines l where l.event_id = e.id'));
    assert.ok(events?.sql.includes('"e"."paid_on"'));
    assert.equal(await store.ledger('r1', 'nope'), null);
    const empty = createLedgerStore(createRecordingDb(() => []).db);
    assert.equal(await empty.ledger('r1', ID), null);
    await assert.rejects(
      () =>
        empty.recordEvent('r1', ID, 'k', {
          kind: 'statement',
          coverageId: null,
          note: '',
          payerClaimNumber: null
        }),
      /does not exist/
    );
  });

  it('reads a claim without a patient, a signal or a pending review', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('left join "patients"')
        ? [
            {
              id: ID,
              total_cents: 0,
              pcr_number: null,
              first_name: null,
              last_name: null,
              facility_id: 'f1',
              service_date: null,
              pickup_state: null,
              received: null,
              pending_review: null
            }
          ]
        : []
    );
    assert.deepEqual(await createLedgerStore(db).ledger('r1', ID), {
      totalCents: 0,
      facilityId: 'f1',
      serviceDate: null,
      pickupState: null,
      pendingReview: false,
      signalsSeen: 0,
      reference: '',
      coverages: [],
      events: []
    });
  });

  it('has no previous report for a claim not billed from an import', async () => {
    const { db } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.startsWith('select "c"."status"')
          ? [{ status: 'needs_review', bucket: null, key: null }]
          : []
    );
    assert.deepEqual(
      await createLedgerStore(db).noteRevision('r1', ID, 'k1', {
        bucket: 'ugula',
        key: 'imports/t-1/g.xml.reports/00000.json'
      }),
      { status: 'needs_review', previous: null }
    );
  });

  it('drops the payer claim number of an event without a coverage', async () => {
    const { db, queries } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createLedgerStore(db).recordEvent('r1', ID, 'k1', {
      kind: 'statement',
      coverageId: null,
      note: 'Sent',
      payerClaimNumber: 'PCN-7'
    });
    assert.deepEqual(queries.at(-1)?.parameters, [
      't-1',
      ID,
      'statement',
      null,
      'Sent',
      null,
      'k1'
    ]);
  });

  it('reads a document of the claim', async () => {
    const DOC = '0195f2a4-0000-7000-8000-0000000000d1';
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.includes('from "claim_documents"')
          ? [{ id: DOC, kind: 'pcs', signed_on: '2026-09-01', file_name: 'pcs.pdf' }]
          : []
    );
    const store = createLedgerStore(db);
    assert.deepEqual(await store.claimDocument('r1', ID, DOC), {
      id: DOC,
      kind: 'pcs',
      signedOn: '2026-09-01',
      fileName: 'pcs.pdf'
    });
    assert.equal(await store.claimDocument('r1', ID, 'not-a-uuid'), null);
    assert.ok(sqlOf(queries, 'select "id", "kind", "signed_on"')[0]?.parameters.includes(ID));
  });

  it('records coverage events idempotently', async () => {
    const { db, queries } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createLedgerStore(db).recordEvent('r1', ID, 'k1', {
      kind: 'resubmit_queued',
      coverageId: 'cov-1',
      note: '',
      payerClaimNumber: 'PCN-7'
    });
    const insert = queries.at(-1);
    assert.ok(insert?.sql.includes('"coverage_id"'));
    assert.ok(insert?.parameters.includes('cov-1'));
    assert.ok(insert?.parameters.includes('PCN-7'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
  });
});

const stored: { key: string; size: number; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, size: body.byteLength, type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  },
  getBytes: async () => new Uint8Array()
};

describe('createStatementStore', () => {
  it('gathers statement data from lines, payments, refunds and protections dated in the agency zone, without an agency when there is no billing profile', async () => {
    const claimRow = {
      id: ID,
      pcr_number: 'PCR-1',
      total_cents: 95_000,
      balance_cents: 35_000,
      service_date: '2026-10-01',
      first_name: 'Jane',
      last_name: 'Doe',
      address_line: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postal_code: '62704',
      organization_name: 'Development EMS',
      agency_address: '100 Station Rd',
      agency_city: 'Springfield',
      agency_state: 'IL',
      agency_postal_code: '62704',
      phone: '2175550100',
      time_zone: 'America/Chicago'
    };
    const responses = [
      {
        kind: 'response',
        payer: 'Medicare',
        paid_cents: 40_000,
        adjusted_cents: 10_000,
        paid_on: '2026-10-18',
        created_at: new Date('2026-10-20T00:00:00Z')
      },
      {
        kind: 'response',
        payer: null,
        paid_cents: 5_000,
        adjusted_cents: 0,
        paid_on: null,
        created_at: '2026-10-26T02:30:00Z'
      },
      {
        kind: 'refunded',
        payer: 'Medicare',
        paid_cents: -1_000,
        adjusted_cents: 0,
        paid_on: '2026-10-28',
        created_at: '2026-10-28T00:00:00Z'
      },
      {
        kind: 'balance_protected',
        payer: null,
        paid_cents: 0,
        adjusted_cents: 6_000,
        paid_on: '2026-10-30',
        created_at: '2026-10-30T00:00:00Z'
      }
    ];
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [claimRow]
        : q.sql.includes('from "claim_lines"')
          ? [
              {
                code: 'A0427',
                units: '1.00',
                unit_cents: 95_000,
                total_cents: 95_000,
                description: 'ALS1, emergency transport'
              }
            ]
          : responses
    );
    const data = await createStatementStore(db, blobs).statementData('r1', ID);
    assert.equal(data.agency?.name, 'Development EMS');
    assert.equal(data.agency?.timeZone, 'America/Chicago');
    assert.equal(data.patient.name, 'Jane Doe');
    assert.equal(data.serviceDate, '2026-10-01');
    assert.deepEqual(data.lines, [
      {
        code: 'A0427',
        units: 1,
        unitCents: 95_000,
        totalCents: 95_000,
        description: 'ALS1, emergency transport'
      }
    ]);
    assert.deepEqual(data.payments, [
      { date: '2026-10-18', from: 'Medicare', paidCents: 40_000, adjustedCents: 10_000 },
      { date: '2026-10-25', from: 'Patient', paidCents: 5_000, adjustedCents: 0 },
      { date: '2026-10-28', from: 'Medicare', paidCents: -1_000, adjustedCents: 0 },
      { date: '2026-10-30', from: 'Development EMS', paidCents: 0, adjustedCents: 6_000 }
    ]);
    assert.equal(data.balanceCents, 35_000);
    assert.ok(queries[0]?.sql.includes('inner join "claim_balances" as "cb"'));
    const payments = queries.find((q) => q.sql.includes('from "claim_events" as "e"'));
    assert.ok(payments?.sql.includes('("e"."paid_cents" <> $'));
    assert.ok(payments?.parameters.includes('refunded'));
    assert.ok(payments?.parameters.includes('balance_protected'));
    const missing = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [{ ...claimRow, organization_name: null, phone: null }]
        : []
    );
    assert.equal(
      (await createStatementStore(missing.db, blobs).statementData('r1', ID)).agency,
      null
    );
  });

  it('dates payments in UTC, names the agency and the claim by id when the profile and PCR are missing', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [
            {
              id: ID,
              pcr_number: null,
              total_cents: 1_000,
              balance_cents: 0,
              service_date: null,
              first_name: 'Jane',
              last_name: 'Doe',
              address_line: null,
              city: null,
              state: null,
              postal_code: null,
              organization_name: null,
              agency_address: null,
              agency_city: null,
              agency_state: null,
              agency_postal_code: null,
              phone: null,
              time_zone: null
            }
          ]
        : q.sql.includes('from "claim_lines"')
          ? []
          : [
              {
                kind: 'balance_protected',
                payer: null,
                paid_cents: 0,
                adjusted_cents: 1_000,
                paid_on: null,
                created_at: '2026-10-26T02:30:00Z'
              }
            ]
    );
    const data = await createStatementStore(db, blobs).statementData('r1', ID);
    assert.deepEqual(
      [data.agency, data.reference, data.serviceDate, data.payments],
      [
        null,
        '0195f2a4',
        null,
        [{ date: '2026-10-26', from: 'Agency', paidCents: 0, adjustedCents: 1_000 }]
      ]
    );
  });

  it('refuses a claim it cannot find, never querying a non-UUID id', async () => {
    const { db, queries } = createRecordingDb();
    const store = createStatementStore(db, blobs);
    await assert.rejects(() => store.statementData('r1', 'nope'), /Claim nope does not exist/);
    assert.equal(queries[0]?.parameters[0], null);
    await assert.rejects(() => store.statementData('r1', ID), new RegExp(`Claim ${ID} does not`));
    assert.equal(queries.length, 2);
  });

  it('stores statement PDFs under the agency and logs them once per step', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, agency_id: 't-1' }] : []
    );
    await createStatementStore(db, blobs).saveStatement('r1', ID, 'r1:s:stmt:0', {
      number: 2,
      count: 4,
      pdf: new Uint8Array([37, 80, 68, 70])
    });
    assert.deepEqual(stored.at(-1), {
      key: statementKey('t-1', ID, 2, 'r1:s:stmt:0'),
      size: 4,
      type: 'application/pdf'
    });
    assert.match(stored.at(-1)?.key ?? '', /^statements\/t-1\/[0-9a-f-]{36}\/2-[0-9a-f]{16}\.pdf$/);
    const insert = queries.at(-1);
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    assert.ok(insert?.parameters.includes('Patient statement 2 of 4'));
  });
});

const createStore = (
  db: Db,
  b: Pick<BlobStore, 'putBytes' | 'getBytes'> = blobs,
  clearinghouse: (agencyId: string) => Promise<Clearinghouse | null> = async () => null
) => createSubmissionStore(db, b, async () => null, clearinghouse);

const profile = {
  organization_name: sampleSubmitter.organizationName,
  npi: sampleSubmitter.npi,
  tax_id: sampleSubmitter.taxId,
  address_line: sampleSubmitter.addressLine,
  city: sampleSubmitter.city,
  state: sampleSubmitter.state,
  postal_code: sampleSubmitter.postalCode,
  phone: sampleSubmitter.phone,
  submitter_id: sampleSubmitter.submitterId,
  receiver_id: sampleSubmitter.receiverId,
  receiver_name: sampleSubmitter.receiverName,
  is_production: sampleSubmitter.production
};

describe('createSubmissionStore', () => {
  it('gives the submitter and no pending claim when the claim is not ready to submit', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"')
        ? [{ agency_id: 't-1' }]
        : q.sql.includes('from "billing_profiles"')
          ? [profile]
          : []
    );
    const store = createStore(db);
    assert.deepEqual(await store.submission('r1', ID, 'cov-1'), {
      submitter: sampleSubmitter,
      pending: null
    });
    const ready = queries.find((q) => q.sql.includes('inner join "patients" as "p"'));
    assert.ok(ready?.parameters.includes('t-1') && ready.parameters.includes('ready'));
    await assert.rejects(() => store.submission('r1', 'bad', 'cov-1'), /Claim bad does not exist/);
    const unknown = createStore(createRecordingDb().db);
    await assert.rejects(() => unknown.submission('r1', ID, 'cov-1'), /does not exist/);
  });

  it('builds the pending claim from the ready row and its ledger, without a submitter profile', async () => {
    const row = {
      id: ID,
      number: '20261105-1001',
      pcr_number: 'PCR-1',
      total_cents: 95_000,
      loaded_miles: null,
      is_emergency: true,
      coverages: [{ id: 'cov-1', payer: 'Medicare', relationship: '18' }],
      lines: [{ code: 'A0427', units: '1.00', unit_cents: 95_000, total_cents: 95_000 }],
      diagnoses: ['R079']
    };
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"')
        ? [{ agency_id: 't-1' }]
        : q.sql.includes('inner join "patients" as "p"')
          ? [row]
          : []
    );
    const ledger = { events: [] } as unknown as Awaited<ReturnType<ClaimStore['ledger']>>;
    const store = createSubmissionStore(
      db,
      blobs,
      async () => ledger,
      async () => null
    );
    const { submitter, pending } = await store.submission('r1', ID, 'cov-1');
    assert.equal(submitter, null);
    assert.deepEqual(
      [
        pending?.id,
        pending?.coverageId,
        pending?.pcrNumber,
        pending?.resubmission,
        pending?.totalCents,
        pending?.claim.claimId,
        pending?.claim.payer.name
      ],
      [ID, 'cov-1', 'PCR-1', false, 95_000, '20261105-1001', 'Medicare']
    );
    assert.equal((await store.submission('r1', ID, 'cov-2')).pending, null);
  });

  it('files a first submission as submitted', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.includes('for update of "c"')
          ? [{ id: ID }]
          : q.sql.startsWith('update "billing_profiles"')
            ? [{ control_number: 9 }]
            : q.sql.startsWith('insert into "claim_batches"')
              ? [{}]
              : []
    );
    await createStore(db).saveSubmission('r1', ID, 'k2', {
      coverageId: 'cov-1',
      resubmission: false,
      totalCents: 95_000,
      production: true,
      build: (n: number) => `ISA*${n}~`
    });
    const [event] = sqlOf(queries, 'insert into "claim_events"');
    assert.deepEqual(
      [event?.parameters[2], event?.parameters[3], event?.parameters[4]],
      ['submitted', 'cov-1', '837P file #9']
    );
  });

  it('files a ready claim as its own numbered 837P file and marks it submitted', async () => {
    stored.length = 0;
    const filing = (rows: { filed?: number; ready?: boolean; number?: number }) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.includes('from "claim_events" as "e" inner join "claim_batches"')
            ? rows.filed === undefined
              ? []
              : [{ control_number: rows.filed }]
            : q.sql.includes('for update of "c"')
              ? rows.ready
                ? [{ id: ID }]
                : []
              : q.sql.startsWith('update "billing_profiles"')
                ? rows.number === undefined
                  ? []
                  : [{ control_number: rows.number }]
                : q.sql.startsWith('insert into "claim_batches"')
                  ? [{}]
                  : []
      );
    const file = {
      coverageId: 'cov-1',
      resubmission: true,
      totalCents: 95_000,
      production: false,
      build: (n: number) => `ISA*${n}~`
    };
    const fresh = filing({ ready: true, number: 7 });
    assert.deepEqual(await createStore(fresh.db).saveSubmission('r1', ID, 'k1', file), {
      controlNumber: 7
    });
    assert.match(stored[0]?.key ?? '', /^batches\/t-1\/[0-9a-f-]{36}\/837P-000000007\.txt$/);
    assert.deepEqual([stored[0]?.size, stored[0]?.type], [6, 'application/edi-x12']);
    const [batch] = sqlOf(fresh.queries, 'insert into "claim_batches"');
    assert.ok(batch?.parameters.includes(7) && batch.parameters.includes(95_000));
    const [event] = sqlOf(fresh.queries, 'insert into "claim_events"');
    assert.ok(event?.parameters.includes('resubmitted') && event.parameters.includes('cov-1'));
    assert.ok(event?.parameters.includes('837P file #7') && event.parameters.includes('k1'));
    const [marked] = sqlOf(fresh.queries, 'update "claims"');
    assert.deepEqual(marked?.parameters.slice(0, 1), ['submitted']);

    const replay = filing({ filed: 5 });
    assert.deepEqual(await createStore(replay.db).saveSubmission('r1', ID, 'k1', file), {
      controlNumber: 5
    });
    assert.equal(sqlOf(replay.queries, 'update').length, 0);
    const moved = filing({});
    assert.equal(await createStore(moved.db).saveSubmission('r1', ID, 'k1', file), 'stale');
    const used = filing({ ready: true });
    assert.equal(await createStore(used.db).saveSubmission('r1', ID, 'k1', file), 'exhausted');
    assert.equal(sqlOf(used.queries, 'insert').length, 0);
    assert.equal(stored.length, 1);
  });

  it('uploads a filed 837P to the clearinghouse once, or leaves it to the biller without one', async () => {
    const BATCH = '0195f2a4-0000-7000-8000-0000000000b1';
    const uploads: [string, string][] = [];
    const agencies: string[] = [];
    const clearinghouse = async (agencyId: string): Promise<Clearinghouse> => {
      agencies.push(agencyId);
      return {
        submitClaims: async (name, bytes) => {
          uploads.push([`${name}.CLP`, new TextDecoder().decode(bytes)]);
          return `${name}.CLP`;
        },
        submitEligibility: async (name) => name,
        submitClaimStatus: async (name) => name,
        checkEligibility: null,
        checkClaimStatus: null,
        inbox: async () => assert.fail('no inbox'),
        afterDownload: 'keep'
      };
    };
    const files = {
      ...blobs,
      getBytes: async (ref: { key: string }) => new TextEncoder().encode(`file:${ref.key}`)
    };
    const sending = (sentAs: string | null) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.includes('from "claim_batches"')
            ? [{ id: BATCH, document: { bucket: 'ugula', key: 'b/7.txt' }, sent_as: sentAs }]
            : []
      );
    const fresh = sending(null);
    const send = createStore(fresh.db, files, clearinghouse);
    assert.deepEqual(await send.sendClaimFile('r1', ID, 7), {
      sentAs: '837P-000000007-0195f2a4.CLP'
    });
    assert.deepEqual(uploads, [['837P-000000007-0195f2a4.CLP', 'file:b/7.txt']]);
    assert.deepEqual(agencies, ['t-1']);
    const lookup = fresh.queries.find((q) => q.sql.includes('from "claim_batches"'));
    assert.deepEqual(lookup?.parameters, ['t-1', 7, ID]);
    assert.ok(lookup?.sql.includes('exists (select "e"."id" from "claim_events" as "e"'));
    const [mark] = sqlOf(fresh.queries, 'update "claim_batches"');
    assert.ok(mark?.sql.endsWith('and "sent_as" is null'));
    assert.deepEqual(mark?.parameters, ['837P-000000007-0195f2a4.CLP', BATCH]);

    const sent = sending('837P-000000007-0195f2a4.CLP');
    assert.deepEqual(await createStore(sent.db, files, clearinghouse).sendClaimFile('r1', ID, 7), {
      sentAs: '837P-000000007-0195f2a4.CLP'
    });
    assert.equal(uploads.length, 1);
    assert.equal(sqlOf(sent.queries, 'update').length, 0);

    const none = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await assert.rejects(
      () => createStore(none.db, files, clearinghouse).sendClaimFile('r1', ID, 8),
      /No 837P file #8/
    );
    const offline = sending(null);
    assert.equal(await createStore(offline.db, files).sendClaimFile('r1', ID, 7), 'manual');
    assert.equal(sqlOf(offline.queries, 'update').length, 0);
  });
});

const USER = '0195f2a4-0000-7000-8000-0000000000a1';

const PDF = new TextEncoder().encode('%PDF-1.7 claim');

type Setup = { status?: string; kept?: boolean; coverages?: { id: string; payer: string }[] };

const setup = ({ status = 'submitted', kept = false, coverages = [] }: Setup = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "id", "agency_id" from "claims"')) {
      return [{ id: ID, agency_id: 't-1' }];
    }
    if (q.sql.includes('for update')) return [{ id: ID, status, patient_id: null }];
    if (q.sql.includes('from "claim_coverages"')) {
      return coverages.map((c) => ({ ...c, has_events: false }));
    }
    if (q.sql.includes('claim_balances')) return [{ balance_cents: 10_000 }];
    if (q.sql.startsWith('select "id" from "claim_documents"')) return kept ? [{ id: 'd0' }] : [];
    if (q.sql.startsWith('insert into "claim_documents"')) return [{ id: 'd1' }];
    if (q.sql.startsWith('insert into "claim_events"')) return [{ id: 'e1' }];
    return [];
  });
  const stored: { key: string; contentType: string }[] = [];
  const store = createClaimTaskStore(
    db,
    {
      getBytes: async () => PDF,
      putBytes: async (key, bytes, contentType) => {
        stored.push({ key, contentType });
        return { bucket: 'b', key, size: bytes.byteLength, contentType };
      }
    },
    boss
  );
  return { queries, stored, store };
};

const payment: ManualPayment = {
  kind: 'response',
  coverageId: null,
  paidCents: 2_500,
  adjustedCents: 0,
  route: null,
  paidOn: null,
  checkNumber: null,
  payerClaimNumber: null,
  adjustments: [],
  note: ''
};

const upload = { bucket: 'b', key: `${uploadsOf('t-1')}u1/pcs form.pdf` };

describe('createClaimTaskStore', () => {
  it('sets payers on an open claim and says why it refuses a draft', async () => {
    const open = setup({ coverages: [{ id: 'm', payer: 'Medicare' }] });
    assert.deepEqual(await open.store.setPayers('r1', ID, ['Medicare', 'Aetna']), {
      status: 'saved'
    });
    assert.ok(open.queries.some((q) => q.sql.startsWith('insert into "claim_coverages"')));
    const draft = await setup({ status: 'draft' }).store.setPayers('r1', ID, []);
    assert.equal(draft.status, 'refused');
  });

  it('posts a payment keyed by the run step, by the biller who entered it', async () => {
    const { queries, store } = setup();
    assert.deepEqual(await store.postPayment('r1', ID, 'run:step', payment, USER), {
      status: 'posted',
      balanceCents: 7_500
    });
    const [event] = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(event?.parameters.includes('run:step') && event.parameters.includes(USER));
    const closed = await setup({ status: 'paid' }).store.postPayment('r1', ID, 'k', payment, 'x');
    assert.deepEqual(closed, { status: 'refused', reason: 'Claim is already closed' });
  });

  it('logs a denial to work when Remittance Routing routed the payment to one', async () => {
    const { queries, store } = setup({ coverages: [{ id: 'm', payer: 'Medicare' }] });
    const denied = { ...payment, coverageId: 'm', paidCents: 0, route: 'appeal' as const };
    assert.equal((await store.postPayment('r1', ID, 'run:step', denied, USER)).status, 'posted');
    const events = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(
      events.some(
        (q) => q.parameters.includes('appeal') && q.parameters.includes('run:step:denied')
      )
    );
    const plain = setup({ coverages: [{ id: 'm', payer: 'Medicare' }] });
    await plain.store.postPayment('r1', ID, 'k', { ...denied, route: 'reconcile' }, USER);
    assert.ok(!plain.queries.some((q) => q.parameters.includes('k:denied')));
  });

  it('keeps an upload as a claim document, typed by its content, once per step', async () => {
    const { queries, stored, store } = setup();
    const added = await store.addDocument('r1', ID, 'run:step', {
      kind: 'pcs',
      signedOn: '2026-09-30',
      file: upload,
      addedBy: USER
    });
    assert.deepEqual(added, { status: 'added', documentId: 'd1' });
    assert.deepEqual(stored, [
      { key: documentKey('t-1', ID, 'run:step', 'pcs form.pdf'), contentType: 'application/pdf' }
    ]);
    const [event] = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(
      event?.parameters.includes('Physician certification statement uploaded: pcs form.pdf')
    );
    const again = setup({ kept: true });
    assert.deepEqual(
      await again.store.addDocument('r1', ID, 'run:step', {
        kind: 'pcs',
        signedOn: null,
        file: upload,
        addedBy: null
      }),
      { status: 'added', documentId: 'd0' }
    );
    assert.ok(!again.queries.some((q) => q.sql.startsWith('insert into "claim_documents"')));
  });

  it('refuses closed claims and files that are not documents, and rejects other uploads', async () => {
    const document = { kind: 'abn' as const, signedOn: null, file: upload, addedBy: null };
    assert.deepEqual(await setup({ status: 'void' }).store.addDocument('r1', ID, 'k', document), {
      status: 'refused',
      reason: 'Claim is already closed'
    });
    const html = setup();
    const store = createClaimTaskStore(
      createRecordingDb((q) =>
        q.sql.startsWith('select "id", "agency_id"') ? [{ id: ID, agency_id: 't-1' }] : []
      ).db,
      {
        getBytes: async () => new TextEncoder().encode('<html>'),
        putBytes: async () => {
          throw new Error('not stored');
        }
      },
      boss
    );
    assert.equal((await store.addDocument('r1', ID, 'k', document)).status, 'refused');
    await assert.rejects(
      () =>
        html.store.addDocument('r1', ID, 'k', {
          ...document,
          file: { bucket: 'b', key: 'imports/t-2/uploads/u1/x.pdf' }
        }),
      /not one of this agency's uploads/
    );
  });
});

describe('createClaimStore', () => {
  it('combines every claim store and leaves 837P files to the biller without a clearinghouse', async () => {
    const { db } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "agency_id" from "claims"')
        ? [{ id: ID, agency_id: 't-1' }]
        : q.sql.includes('from "claim_batches"')
          ? [{ id: 'b1', document: { bucket: 'ugula', key: 'b/7.txt' }, sent_as: null }]
          : []
    );
    const store = createClaimStore(db, blobs, { insert: async () => {} });
    assert.equal(await store.sendClaimFile('r1', ID, 7), 'manual');
    assert.equal(await store.ledger('r1', ID), null);
    assert.deepEqual(await store.facilityDirectory('r1'), []);
  });
});
