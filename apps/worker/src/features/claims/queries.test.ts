import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { NewClaim } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db';
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
    { payer: 'Medicare', payerCode: 'MCR', memberId: 'M1', groupId: null },
    { payer: 'Blue Plan', payerCode: null, memberId: null, groupId: 'G9' }
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

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createClaimStore', () => {
  it('opens a claim, then its lines, coverages and diagnoses', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"') ? [{ id: ID }] : []
    );
    assert.equal(await createClaimStore(db, blobs).openClaim('r1', 'r1:s:open:0', claim), ID);
    const [insert] = sqlOf(queries, 'insert into "claims"');
    assert.ok(insert?.sql.includes('on conflict ("tenant_id", "source_key") do nothing'));
    assert.ok(
      insert?.sql.includes(
        '(select "r"."id" from "import_reports" as "r" inner join "imports" as "i" on "i"."id" = "r"."import_id" where r.report ->> \'key\' = $'
      )
    );
    assert.ok(insert?.parameters.includes('imports/t-1/a/f.xml.reports/00000.json'));
    assert.ok(insert?.parameters.includes('2026-10-01'));
    assert.ok(insert?.parameters.includes('S') && insert.parameters.includes('H'));
    assert.ok(insert?.parameters.includes('St. Mary'));
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
    assert.ok(!coverages?.sql.includes('"payer_id" = $'));
    assert.ok(coverages?.parameters.includes('blue plan'));
    const [diagnoses] = sqlOf(queries, 'insert into "claim_diagnoses"');
    assert.deepEqual(diagnoses?.parameters, [ID, 1, 'R079', ID, 2, 'I10']);
    assert.ok(queries[0]?.sql.startsWith('insert into "claims"'));
  });

  it('returns the existing claim on a replayed step without duplicating its rows', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "id" from "claims"') ? [{ id: ID }] : []
    );
    assert.equal(await createClaimStore(db, blobs).openClaim('r1', 'r1:s:open:0', claim), ID);
    assert.equal(sqlOf(queries, 'insert into "claim_lines"').length, 0);
    assert.ok(
      queries.some((q) => q.parameters.includes('r1:s:open:0') && q.sql.startsWith('select'))
    );
  });

  it('skips optional rows for a claim with no payers, diagnoses or source report', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('insert into "claims"') ? [{ id: ID }] : []
    );
    await createClaimStore(db, blobs).openClaim('r1', 'k', {
      ...claim,
      coverages: [],
      details: { ...claim.details, diagnoses: [], originDestination: null },
      reportKey: null
    });
    assert.equal(sqlOf(queries, 'insert into "claim_coverages"').length, 0);
    assert.equal(sqlOf(queries, 'insert into "claim_diagnoses"').length, 0);
    assert.ok(!sqlOf(queries, 'insert into "claims"')[0]?.sql.includes('import_reports'));
  });

  it('reads the ledger by coverage in billing order and refuses other tenants or bad ids', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [{ id: ID, total_cents: 95_000 }]
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
    const close = async (locked: { status: string; balance_cents: number }) => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.includes('for update')
          ? [{ status: locked.status }]
          : q.sql.includes('from "claim_balances"')
            ? [{ balance_cents: locked.balance_cents }]
            : q.sql.startsWith('select')
              ? [{ id: ID, total_cents: 1 }]
              : []
      );
      await createClaimStore(db, blobs).closeClaim('r1', ID, 'k2', 'written_off');
      return queries;
    };
    const owed = await close({ status: 'open', balance_cents: 500 });
    const lockAt = owed.findIndex((q) => q.sql.endsWith('for update'));
    const balanceAt = owed.findIndex((q) => q.sql.includes('from "claim_balances"'));
    assert.ok(lockAt >= 0 && balanceAt > lockAt);
    assert.deepEqual(owed.find((q) => q.sql.startsWith('update'))?.parameters[0], 'written_off');
    const settled = await close({ status: 'open', balance_cents: 0 });
    assert.deepEqual(settled.find((q) => q.sql.startsWith('update'))?.parameters[0], 'paid');
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
