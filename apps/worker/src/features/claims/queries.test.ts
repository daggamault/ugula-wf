import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { createClaimStore, NO_PROFILE, statementKey } from './queries.ts';

const stored: { key: string; size: number; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, size: body.byteLength, type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  }
};

const ID = '0195f2a4-0000-7000-8000-000000000001';

const claim = {
  patientId: 'p1',
  pcrNumber: 'PCR-1',
  level: 'ALS1',
  emergency: true,
  loadedMiles: 12.4,
  lines: [{ code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 }],
  totalCents: 95_000,
  payers: ['Medicare'],
  coverages: [{ payer: 'Medicare', payerCode: null, memberId: 'M1', groupId: null }],
  details: {
    serviceDate: '2026-10-01',
    pickup: { name: null, addressLine: null, city: null, state: null, postalCode: null },
    destination: { name: null, addressLine: null, city: null, state: null, postalCode: null },
    diagnoses: ['R079'],
    originDestination: null
  }
};

describe('createClaimStore', () => {
  it('opens claims once per source key in the run tenant', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: ID }]);
    assert.equal(await createClaimStore(db, blobs).openClaim('r1', 'r1:s:open:0', claim), ID);
    const [q] = queries;
    assert.ok(q?.sql.includes('(select "tenant_id" from "workflow_runs" where "id" = $1)'));
    assert.ok(q?.sql.includes('on conflict ("tenant_id", "source_key") do update'));
    assert.ok(q?.parameters.includes('r1:s:open:0'));
  });

  it('reads the ledger in event order and refuses other tenants or bad ids', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "claims"')
        ? [{ id: ID, total_cents: 95_000, payers: ['Medicare'] }]
        : [
            {
              kind: 'submitted',
              payer: 'Medicare',
              paid_cents: 0,
              adjusted_cents: 0,
              created_at: new Date('2026-01-01T00:00:00.000Z')
            }
          ]
    );
    const store = createClaimStore(db, blobs);
    assert.deepEqual(await store.ledger('r1', ID), {
      totalCents: 95_000,
      payers: ['Medicare'],
      events: [
        {
          kind: 'submitted',
          payer: 'Medicare',
          paidCents: 0,
          adjustedCents: 0,
          at: '2026-01-01T00:00:00.000Z'
        }
      ]
    });
    assert.ok(queries[1]?.sql.endsWith('order by "created_at", "id"'));
    assert.equal(await store.ledger('r1', 'nope'), null);
    const empty = createClaimStore(createRecordingDb(() => []).db, blobs);
    assert.equal(await empty.ledger('r1', ID), null);
    await assert.rejects(
      () => empty.recordEvent('r1', ID, 'k', { kind: 'statement', payer: null, note: '' }),
      /does not exist/
    );
  });

  it('links a claim to a cycle run of the same tenant only', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, total_cents: 1, payers: [] }] : []
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

  it('records events idempotently', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, total_cents: 1, payers: [] }] : []
    );
    await createClaimStore(db, blobs).recordEvent('r1', ID, 'k1', {
      kind: 'resubmit_queued',
      payer: 'Medicare',
      note: ''
    });
    assert.ok(queries.at(-1)?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
  });

  it('closes under a row lock, as paid when nothing is owed, and only open claims', async () => {
    const close = async (locked: { status: string; balance_cents: number }) => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.includes('for update')
          ? [{ status: locked.status }]
          : q.sql.includes('as "balance_cents"')
            ? [{ balance_cents: locked.balance_cents }]
            : q.sql.startsWith('select')
              ? [{ id: ID, total_cents: 1, payers: [] }]
              : []
      );
      await createClaimStore(db, blobs).closeClaim('r1', ID, 'k2', 'written_off');
      return queries;
    };
    const owed = await close({ status: 'open', balance_cents: 500 });
    const lockAt = owed.findIndex((q) => q.sql.endsWith('for update'));
    const balanceAt = owed.findIndex((q) => q.sql.includes('as "balance_cents"'));
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

  it('gathers statement data and refuses without a billing profile', async () => {
    const claimRow = {
      id: ID,
      pcr_number: 'PCR-1',
      lines: [{ code: 'A0427', units: 1, unitCents: 95_000, totalCents: 95_000 }],
      total_cents: 95_000,
      details: { serviceDate: '2026-10-01' },
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
      {
        payer: 'Blue',
        paid_cents: 0,
        adjusted_cents: 0,
        created_at: new Date('2026-10-21T00:00:00Z')
      }
    ];
    const { db } = createRecordingDb((q) =>
      q.sql.includes('from "claims" as "c"') ? [claimRow] : responses
    );
    const data = await createClaimStore(db, blobs).statementData('r1', ID);
    assert.equal(data.agency.name, 'Development EMS');
    assert.equal(data.patient.name, 'Jane Doe');
    assert.equal(data.serviceDate, '2026-10-01');
    assert.deepEqual(data.payments, [
      { date: '2026-10-20', from: 'Medicare', paidCents: 40_000, adjustedCents: 10_000 }
    ]);
    assert.equal(data.balanceCents, 45_000);
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
