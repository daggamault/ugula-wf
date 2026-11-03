import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimPatch, DraftClaim, NewClaim } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunJob, RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createClaimStore as createStore, statementKey } from './queries.ts';

const stored: { key: string; size: number; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, size: body.byteLength, type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  }
};

const jobs: RunJob[] = [];

const boss: RunQueueClient = {
  insert: async (_, inserted) => {
    jobs.push(...inserted.map((j) => j.data as RunJob));
  }
};

const createClaimStore = (db: Parameters<typeof createStore>[0], b: typeof blobs) =>
  createStore(db, b, boss);

const ID = '0195f2a4-0000-7000-8000-000000000001';

const OLD_RUN = '0195f2a4-0000-7000-8000-0000000000a1';

const owned = { id: ID, tenant_id: 't-1' };

const CYCLE = '0195f2a4-0000-7000-8000-0000000000c1';

const place = { addressLine: null, city: null, state: null, postalCode: null };

const claim: NewClaim = {
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  tripType: 'emergency',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
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
    originDestination: 'SH'
  },
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json'
};

const draft: DraftClaim = {
  pcrNumber: 'PCR-1',
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json',
  claimId: null
};

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "tenant_id" from "claims"');

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createClaimStore', () => {
  it('opens a draft claim without a patient, linked to its source report and its run', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"') ? [{ id: ID }] : []
    );
    assert.deepEqual(await createClaimStore(db, blobs).openDraft('r1', 'r1:s:open:0', draft), {
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

  it('assigns a patient of the same tenant to a draft, or again to the same patient', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update') ? [{}] : []
    );
    await createClaimStore(db, blobs).assignPatient('r1', ID, 'k', ID);
    const update = queries.at(-1);
    assert.ok(
      update?.sql.startsWith(
        'update "claims" set "patient_id" = (select "id" from "patients" where "id" = $1 and "tenant_id" = $2)'
      )
    );
    assert.ok(update?.sql.includes('exists (select "id" from "patients"'));
    assert.ok(update?.sql.includes('or "patient_id" = (select "id" from "patients"'));
    assert.ok(update?.parameters.includes('draft'));
  });

  it('refuses unknown patients, claims that are no longer drafts and unknown claims', async () => {
    const { db } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    const store = createClaimStore(db, blobs);
    await assert.rejects(() => store.assignPatient('r1', ID, 'k', ID), /is not a draft/);
    await assert.rejects(() => store.assignPatient('r1', ID, 'k', 'nope'), /does not exist/);
    const none = createClaimStore(createRecordingDb().db, blobs);
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
      await createClaimStore(db, blobs).openDraft('r1', 'r1:s:open:0', { ...draft, claimId: ID }),
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
      createClaimStore(createRecordingDb().db, blobs).openDraft('r1', 'k', {
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
      await createClaimStore(replay.db, blobs).openDraft('r1', 'r1:s:open:0', draft),
      {
        id: ID,
        duplicate: false
      }
    );
    const query = sqlOf(replay.queries, 'select "id", "source_key" from "claims"')[0];
    assert.ok(query?.sql.includes('("source_key" = $2 or "pcr_number" = $3)'));
    assert.ok(query?.sql.endsWith('order by source_key = $4 desc'));
    const other = lookup('other-run:s:open:0');
    assert.deepEqual(
      await createClaimStore(other.db, blobs).openDraft('r1', 'r1:s:open:0', draft),
      {
        id: ID,
        duplicate: true
      }
    );
    assert.equal(sqlOf(other.queries, 'insert into "claim_runs"').length, 1);
  });

  it('fills a draft with its trip type, lines, coverages and diagnoses and keeps it a draft', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    await createClaimStore(db, blobs).saveClaim('r1', ID, 'k', claim);
    const [update] = sqlOf(queries, 'update "claims"');
    assert.ok(update?.sql.endsWith('where "id" = $20 and "status" = $21'));
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
    assert.ok(coverages?.sql.includes('(select "id" from "payers" where "tenant_id" ='));
    assert.ok(coverages?.parameters.includes('medicare') && coverages.parameters.includes('MCR'));
    assert.ok(coverages?.sql.includes('and "id" = $'));
    assert.ok(coverages?.parameters.includes('0195f2a4-0000-7000-8000-00000000000b'));
    assert.ok(!coverages?.parameters.includes('bcbs'));
    const [diagnoses] = sqlOf(queries, 'insert into "claim_diagnoses"');
    assert.deepEqual(diagnoses?.parameters, [ID, 1, 'R079', ID, 2, 'I10']);
  });

  it('drops repeated payers by name and member ID, and repeated diagnosis codes', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    const [medicare] = claim.coverages;
    assert.ok(medicare);
    await createClaimStore(db, blobs).saveClaim('r1', ID, 'k', {
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

  it('saves only drafts, and skips optional rows it does not have', async () => {
    const saved = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createClaimStore(saved.db, blobs).saveClaim('r1', ID, 'k', claim);
    assert.equal(sqlOf(saved.queries, 'with "lines"').length, 0);
    const bare = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.startsWith('update "claims"') ? [{}] : []
    );
    await createClaimStore(bare.db, blobs).saveClaim('r1', ID, 'k', {
      ...claim,
      coverages: [],
      details: { ...claim.details, diagnoses: [] }
    });
    assert.equal(sqlOf(bare.queries, 'insert into "claim_coverages"').length, 0);
    assert.equal(sqlOf(bare.queries, 'insert into "claim_diagnoses"').length, 0);
  });

  it('writes the cycle status only while the claim signals match the ledger it came from', async () => {
    let received = 4;
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.includes('with current as') ? [{ received }] : []
    );
    const store = createClaimStore(db, blobs);
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 4), 'set');
    const write = queries.find((q) => q.sql.includes('with current as'));
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

  it('reads a claim check for the run tenant', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "tenant_id" from "workflow_runs"') ? [{ tenant_id: 't-1' }] : []
    );
    const store = createClaimStore(db, blobs);
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
      tripType: null,
      level: null,
      emergency: null,
      loadedMiles: null,
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
    await createClaimStore(db, blobs).patchClaim('r1', ID, 'r1:s:patch:0', patch);
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
    await createClaimStore(replay.db, blobs).patchClaim('r1', ID, 'r1:s:patch:0', patch);
    assert.equal(sqlOf(replay.queries, 'insert into "signals"').length, 0);
    assert.equal(sqlOf(replay.queries, 'update').length, 0);
    assert.deepEqual(jobs, []);
  });

  it('notes revisions with the new report and returns the status and the report it was billed from', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.startsWith('select "c"."status"')
          ? [{ status: 'submitted', bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }]
          : []
    );
    const store = createClaimStore(db, blobs);
    const report = { bucket: 'ugula', key: 'imports/t/g.xml.reports/00000.json' };
    assert.deepEqual(await store.noteRevision('r1', ID, 'k1', report), {
      status: 'submitted',
      previous: { bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }
    });
    const [insert] = sqlOf(queries, 'insert into "claim_events"');
    assert.ok(insert?.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.parameters.includes('revised'));
    assert.ok(insert?.parameters.includes(JSON.stringify(report)));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
  });

  it('reads the ledger by coverage in billing order and refuses other tenants or bad ids', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('left join "patients"')
        ? [
            {
              id: ID,
              total_cents: 95_000,
              pcr_number: 'PCR-1',
              first_name: 'Jane',
              last_name: 'Doe',
              received: 4
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
                created_at: new Date('2026-01-01T00:00:00.000Z')
              }
            ]
    );
    const store = createClaimStore(db, blobs);
    assert.deepEqual(await store.ledger('r1', ID), {
      totalCents: 95_000,
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
          at: '2026-01-01T00:00:00.000Z'
        }
      ]
    });
    const [head] = queries;
    assert.ok(head?.sql.includes('(select "s"."received" from "signals" as "s"'));
    assert.deepEqual(head?.parameters.slice(0, 2), [`claim:${ID}`, ID]);
    assert.equal(queries.length, 3);
    const coverages = queries.find((q) => q.sql.includes('from "claim_coverages"'));
    assert.ok(coverages?.sql.includes('coalesce(dp.name, cc.payer_name) as "payer"'));
    assert.ok(coverages?.sql.endsWith('order by "cc"."position"'));
    const events = queries.find((q) => q.sql.includes('from "claim_events" as "e"'));
    assert.ok(events?.sql.endsWith('order by "e"."created_at", "e"."id"'));
    assert.ok(events?.sql.includes('from claim_event_adjustments a where a.event_id = e.id'));
    assert.ok(events?.sql.includes('"e"."paid_on"'));
    assert.equal(await store.ledger('r1', 'nope'), null);
    const empty = createClaimStore(createRecordingDb(() => []).db, blobs);
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

  it('links a claim to a cycle run of the same tenant only', async () => {
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
    await createClaimStore(db, blobs).attachCycle('r1', ID, 'k', CYCLE);
    const run = queries.find((q) => q.sql.startsWith('select "id" from "workflow_runs"'));
    assert.ok(run?.parameters.includes('t-1'));
    const [update] = sqlOf(queries, 'update "claims"');
    assert.deepEqual(update?.parameters.slice(0, 1), [CYCLE]);
    assert.ok(update?.sql.includes('"c"."cycle_run_id" is null'));
    assert.ok(update?.sql.includes('not exists (select "r"."id" from "workflow_runs" as "r"'));
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.deepEqual(link?.parameters.slice(0, 2), [ID, CYCLE]);
    const busy = attach(false);
    await assert.rejects(
      () => createClaimStore(busy.db, blobs).attachCycle('r1', ID, 'k', CYCLE),
      /already has an active payer cycle/
    );
    assert.equal(sqlOf(busy.queries, 'insert into "claim_runs"').length, 0);
    const missing = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    const store = createClaimStore(missing.db, blobs);
    await assert.rejects(() => store.attachCycle('r1', ID, 'k', CYCLE), /does not exist/);
    await assert.rejects(() => store.attachCycle('r1', ID, 'k', 'cycle-1'), /does not exist/);
    assert.equal(sqlOf(missing.queries, 'update').length, 0);
  });

  it('records coverage events idempotently', async () => {
    const { db, queries } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createClaimStore(db, blobs).recordEvent('r1', ID, 'k1', {
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
      await createClaimStore(db, blobs).closeClaim('r1', ID, 'k2', requested);
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

  it('gathers statement data from lines, payments and refunds, without an agency when there is no billing profile', async () => {
    const claimRow = {
      id: ID,
      pcr_number: 'PCR-1',
      total_cents: 95_000,
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
        payer: 'Medicare',
        paid_cents: 40_000,
        adjusted_cents: 10_000,
        paid_on: '2026-10-18',
        created_at: new Date('2026-10-20T00:00:00Z')
      },
      {
        payer: null,
        paid_cents: 5_000,
        adjusted_cents: 0,
        paid_on: null,
        created_at: '2026-10-25T00:00:00Z'
      },
      {
        payer: 'Medicare',
        paid_cents: -1_000,
        adjusted_cents: 0,
        paid_on: '2026-10-28',
        created_at: '2026-10-28T00:00:00Z'
      }
    ];
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [claimRow]
        : q.sql.includes('from "claim_lines"')
          ? [{ code: 'A0427', units: '1.00', unit_cents: 95_000, total_cents: 95_000 }]
          : responses
    );
    const data = await createClaimStore(db, blobs).statementData('r1', ID);
    assert.equal(data.agency?.name, 'Development EMS');
    assert.equal(data.agency?.timeZone, 'America/Chicago');
    assert.equal(data.patient.name, 'Jane Doe');
    assert.equal(data.serviceDate, '2026-10-01');
    assert.deepEqual(data.lines, [
      { code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 }
    ]);
    assert.deepEqual(data.payments, [
      { date: '2026-10-18', from: 'Medicare', paidCents: 40_000, adjustedCents: 10_000 },
      { date: '2026-10-25', from: 'Patient', paidCents: 5_000, adjustedCents: 0 },
      { date: '2026-10-28', from: 'Medicare', paidCents: -1_000, adjustedCents: 0 }
    ]);
    assert.equal(data.balanceCents, 41_000);
    const payments = queries.find((q) => q.sql.includes('from "claim_events" as "e"'));
    assert.ok(payments?.sql.includes('("e"."paid_cents" <> $'));
    assert.ok(payments?.parameters.includes('refunded'));
    const missing = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [{ ...claimRow, organization_name: null, phone: null }]
        : []
    );
    assert.equal((await createClaimStore(missing.db, blobs).statementData('r1', ID)).agency, null);
  });

  it('stores statement PDFs under the tenant and logs them once per step', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, tenant_id: 't-1' }] : []
    );
    await createClaimStore(db, blobs).saveStatement('r1', ID, 'r1:s:stmt:0', {
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
