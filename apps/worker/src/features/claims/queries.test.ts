import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { DraftClaim, NewClaim } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createClaimStore, NO_PROFILE, statementKey } from './queries.ts';

const stored: { key: string; size: number; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, size: body.byteLength, type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  }
};

const ID = '0195f2a4-0000-7000-8000-000000000001';

const place = { addressLine: null, city: null, state: null, postalCode: null };

const claim: NewClaim = {
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  lines: [
    { code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 },
    { code: 'A0425', units: 12.4, unitCents: 1_550, totalCents: 19_220 }
  ],
  totalCents: 114_220,
  coverages: [
    { payer: 'Medicare', payerId: null, payerCode: 'MCR', memberId: 'M1', groupId: null },
    {
      payer: 'BCBS',
      payerId: '0195f2a4-0000-7000-8000-00000000000b',
      payerCode: null,
      memberId: null,
      groupId: 'G9'
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
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  reportKey: 'imports/t-1/a/f.xml.reports/00000.json'
};

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createClaimStore', () => {
  it('opens a draft claim linked to its source report', async () => {
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
    assert.ok(insert?.parameters.includes('PCR-1') && insert.parameters.includes('p1'));
    assert.ok(!insert?.sql.includes('"level"'));
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
  });

  it('fills a draft with its lines, coverages and diagnoses and moves it to review', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "total_cents" from "claims"')
        ? [{ id: ID, total_cents: 0 }]
        : q.sql.startsWith('select "status" from "claims"')
          ? [{ status: 'draft' }]
          : []
    );
    await createClaimStore(db, blobs).saveClaim('r1', ID, claim);
    const [update] = sqlOf(queries, 'update "claims"');
    assert.ok(update?.parameters.includes('needs_review') && update.parameters.includes('ALS1'));
    assert.ok(update?.parameters.includes('2026-10-01'));
    assert.ok(update?.parameters.includes('S') && update.parameters.includes('H'));
    assert.ok(update?.parameters.includes('St. Mary'));
    assert.equal(sqlOf(queries, 'delete from').length, 3);
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

  it('saves a draft only once, and skips optional rows it does not have', async () => {
    const saved = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "total_cents" from "claims"')
        ? [{ id: ID, total_cents: 1 }]
        : q.sql.startsWith('select "status" from "claims"')
          ? [{ status: 'ready' }]
          : []
    );
    await createClaimStore(saved.db, blobs).saveClaim('r1', ID, claim);
    assert.equal(sqlOf(saved.queries, 'update "claims"').length, 0);
    const bare = createRecordingDb((q) =>
      q.sql.startsWith('select "id", "total_cents" from "claims"')
        ? [{ id: ID, total_cents: 0 }]
        : q.sql.startsWith('select "status" from "claims"')
          ? [{ status: 'draft' }]
          : []
    );
    await createClaimStore(bare.db, blobs).saveClaim('r1', ID, {
      ...claim,
      coverages: [],
      details: { ...claim.details, diagnoses: [] }
    });
    assert.equal(sqlOf(bare.queries, 'insert into "claim_coverages"').length, 0);
    assert.equal(sqlOf(bare.queries, 'insert into "claim_diagnoses"').length, 0);
  });

  it('records the cycle status without touching drafts or closed claims', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, total_cents: 1 }] : []
    );
    await createClaimStore(db, blobs).setStatus('r1', ID, 'submitted');
    const [update] = sqlOf(queries, 'update "claims"');
    assert.ok(update?.sql.includes('"status" <> $'));
    assert.ok(update?.sql.includes('"status" not in ($'));
    assert.deepEqual(
      update?.parameters.filter((x) => typeof x === 'string' && x !== ID),
      ['submitted', 'submitted', 'draft', 'paid', 'written_off', 'collections', 'void']
    );
  });

  it('finds claims by PCR number and notes revisions with the new report', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, total_cents: 1 }] : []
    );
    const store = createClaimStore(db, blobs);
    assert.equal(await store.findByPcr('r1', 'PCR-1'), ID);
    assert.ok(queries[0]?.sql.endsWith('and "pcr_number" = $2'));
    const report = { bucket: 'ugula', key: 'imports/t/g.xml.reports/00000.json' };
    await store.noteRevision('r1', ID, 'k1', report);
    const insert = queries.at(-1);
    assert.ok(insert?.sql.startsWith('insert into "claim_events"'));
    assert.ok(insert?.parameters.includes('revised'));
    assert.ok(insert?.parameters.includes(JSON.stringify(report)));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    const none = createClaimStore(createRecordingDb(() => []).db, blobs);
    assert.equal(await none.findByPcr('r1', 'PCR-9'), null);
  });

  it('reads the ledger by coverage in billing order and refuses other tenants or bad ids', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('inner join "patients"')
        ? [{ pcr_number: 'PCR-1', first_name: 'Jane', last_name: 'Doe' }]
        : q.sql.includes('from "claims"')
          ? [{ id: ID, total_cents: 95_000 }]
          : q.sql.includes('from "signals"')
            ? [{ received: 4 }]
            : q.sql.includes('from "claim_coverages"')
              ? [{ id: 'cov-1', payer: 'Medicare' }]
              : [
                  {
                    kind: 'submitted',
                    coverage_id: 'cov-1',
                    paid_cents: 0,
                    adjusted_cents: 0,
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
          at: '2026-01-01T00:00:00.000Z'
        }
      ]
    });
    const signal = queries.findIndex((q) => q.sql.includes('from "signals"'));
    assert.deepEqual(queries[signal]?.parameters, ['r1', `claim:${ID}`]);
    assert.ok(signal < queries.findIndex((q) => q.sql.includes('from "claim_events"')));
    const coverages = queries.find((q) => q.sql.includes('from "claim_coverages"'));
    assert.ok(coverages?.sql.includes('coalesce(dp.name, cc.payer_name) as "payer"'));
    assert.ok(coverages?.sql.endsWith('order by "cc"."position"'));
    assert.ok(queries.some((q) => q.sql.endsWith('order by "created_at", "id"')));
    assert.equal(await store.ledger('r1', 'nope'), null);
    const empty = createClaimStore(createRecordingDb(() => []).db, blobs);
    assert.equal(await empty.ledger('r1', ID), null);
    await assert.rejects(
      () => empty.recordEvent('r1', ID, 'k', { kind: 'statement', coverageId: null, note: '' }),
      /does not exist/
    );
  });

  it('links a claim to a cycle run of the same tenant only', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, total_cents: 1 }] : []
    );
    await createClaimStore(db, blobs).attachCycle('r1', ID, 'cycle-1');
    const update = queries.at(-1);
    assert.ok(
      update?.sql.startsWith(
        'update "claims" set "cycle_run_id" = (select "id" from "workflow_runs" where "id" = $1 and "tenant_id" = (select'
      )
    );
    assert.ok(update?.parameters.includes('cycle-1'));
  });

  it('records coverage events idempotently', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, total_cents: 1 }] : []
    );
    await createClaimStore(db, blobs).recordEvent('r1', ID, 'k1', {
      kind: 'resubmit_queued',
      coverageId: 'cov-1',
      note: ''
    });
    const insert = queries.at(-1);
    assert.ok(insert?.sql.includes('"coverage_id"'));
    assert.ok(insert?.parameters.includes('cov-1'));
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
            : q.sql.startsWith('select')
              ? [{ id: ID, total_cents: 1 }]
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
    const done = await close({ status: 'paid', balance_cents: 0 });
    assert.equal(
      done.some((q) => q.sql.startsWith('update')),
      false
    );
  });

  it('gathers statement data from lines and payments, and refuses without a billing profile', async () => {
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
      phone: '2175550100'
    };
    const responses = [
      {
        payer: 'Medicare',
        paid_cents: 40_000,
        adjusted_cents: 10_000,
        created_at: new Date('2026-10-20T00:00:00Z')
      },
      { payer: null, paid_cents: 5_000, adjusted_cents: 0, created_at: '2026-10-25T00:00:00Z' }
    ];
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [claimRow]
        : q.sql.includes('from "claim_lines"')
          ? [{ code: 'A0427', units: '1.00', unit_cents: 95_000, total_cents: 95_000 }]
          : responses
    );
    const data = await createClaimStore(db, blobs).statementData('r1', ID);
    assert.equal(data.agency.name, 'Development EMS');
    assert.equal(data.patient.name, 'Jane Doe');
    assert.equal(data.serviceDate, '2026-10-01');
    assert.deepEqual(data.lines, [
      { code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 }
    ]);
    assert.deepEqual(data.payments, [
      { date: '2026-10-20', from: 'Medicare', paidCents: 40_000, adjustedCents: 10_000 },
      { date: '2026-10-25', from: 'Patient', paidCents: 5_000, adjustedCents: 0 }
    ]);
    assert.equal(data.balanceCents, 40_000);
    const payments = queries.find((q) => q.sql.includes('from "claim_events" as "e"'));
    assert.ok(payments?.sql.includes('("e"."paid_cents" > $'));
    const missing = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"')
        ? [{ ...claimRow, organization_name: null, phone: null }]
        : []
    );
    await assert.rejects(
      () => createClaimStore(missing.db, blobs).statementData('r1', ID),
      new RegExp(NO_PROFILE)
    );
  });

  it('stores statement PDFs under the tenant and logs them once per step', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, tenant_id: 't-1' }] : []
    );
    await createClaimStore(db, blobs).saveStatement('r1', ID, 'r1:s:stmt:0', {
      number: 2,
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
    assert.ok(insert?.parameters.includes('Patient statement 2 of 3'));
  });
});
