import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunQueueClient } from '@ugula/run-queue';
import { appealPacketKey, createRecoveryStore } from './queries.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const COV = '0195f2a4-0000-7000-8000-0000000000c1';

const boss: RunQueueClient = { insert: async () => undefined };

const stored: string[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push(key);
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  },
  getBytes: async () => new Uint8Array([1]),
  getJson: async () => ({ 'eRecord.01': 'PCR-1' })
};

const profile = {
  organization_name: 'Metro EMS',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701',
  phone: '2175550100'
};

const recording = (rows: (sql: string) => unknown[]) =>
  createRecordingDb(({ sql }) =>
    sql.startsWith('select "id", "agency_id" from "claims"')
      ? [{ id: ID, agency_id: 't-1' }]
      : rows(sql)
  );

describe('createRecoveryStore', () => {
  it('records a refund as a negative payment and faults when it cannot', async () => {
    const { db, queries } = recording((sql) =>
      sql.includes('for update')
        ? [{ id: ID, status: 'reconcile', patient_id: 'p1' }]
        : sql.includes('claim_balances')
          ? [{ balance_cents: -5_000 }]
          : sql.includes('as "paid"')
            ? [{ paid: 80_000 }]
            : sql.includes('from "claim_coverages"')
              ? [{ id: COV, payer: 'Medicare', has_events: true }]
              : []
    );
    const store = createRecoveryStore(db, blobs, boss);
    await store.recordRefund('r1', ID, 'step-1', {
      coverageId: COV,
      cents: 5_000,
      note: 'Refund',
      paidOn: '2026-10-31'
    });
    const refund = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.ok(refund?.parameters.includes(-5_000) && refund.parameters.includes('refunded'));
    assert.ok(refund?.parameters.includes('2026-10-31'));
    await assert.rejects(
      () =>
        store.recordRefund('r1', ID, 'step-2', {
          coverageId: COV,
          cents: 90_000,
          note: '',
          paidOn: '2026-10-31'
        }),
      /more than the \$800.00 paid/
    );
    await assert.rejects(() =>
      store.recordRefund('r1', 'bad', 'k', {
        coverageId: null,
        cents: 1,
        note: '',
        paidOn: '2026-10-31'
      })
    );
  });

  const protecting = (status: string, balance: number, recorded = false) =>
    recording((sql) =>
      sql.includes('for update')
        ? [{ id: ID, status, patient_id: 'p1' }]
        : sql.includes('claim_balances')
          ? [{ balance_cents: balance }]
          : sql.startsWith('select "id" from "claim_events"') && recorded
            ? [{ id: 'e1' }]
            : []
    );

  const protections = (queries: { sql: string; parameters: readonly unknown[] }[]) =>
    queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));

  it('protects at most the balance under the claim lock, nudges the claim and skips every payer that has not answered', async () => {
    const { db, queries } = protecting('patient_balance', 2_500);
    const store = createRecoveryStore(db, blobs, boss);
    await store.protectBalance('r1', ID, 'step-1', { adjustedCents: 4_000, note: 'NH law' });
    await store.skipRemainingPayers('r1', ID, 'step-2', 'Moved to the patient');
    const [protect, skip] = protections(queries);
    assert.ok(queries.some((q) => q.sql.includes('for update')));
    assert.ok(protect?.parameters.includes('balance_protected'));
    assert.ok(protect?.parameters.includes(2_500) && !protect.parameters.includes(4_000));
    assert.ok(queries.some((q) => q.sql.startsWith('insert into "signals"')));
    assert.ok(skip?.sql.includes('select "cc"."claim_id"'));
    assert.ok(skip?.sql.includes('"e"."kind" in ($'));
  });

  it('protects nothing on a settled claim or a step already recorded, and refuses a closed claim', async () => {
    const settled = protecting('patient_balance', 0);
    await createRecoveryStore(settled.db, blobs, boss).protectBalance('r1', ID, 'k', {
      adjustedCents: 4_000,
      note: 'NH law'
    });
    assert.equal(protections(settled.queries).length, 0);
    const replay = protecting('paid', 4_000, true);
    await createRecoveryStore(replay.db, blobs, boss).protectBalance('r1', ID, 'k', {
      adjustedCents: 4_000,
      note: 'NH law'
    });
    assert.equal(protections(replay.queries).length, 0);
    const closed = protecting('paid', 4_000);
    await assert.rejects(
      () =>
        createRecoveryStore(closed.db, blobs, boss).protectBalance('r1', ID, 'k', {
          adjustedCents: 4_000,
          note: 'NH law'
        }),
      /already closed/
    );
  });

  it('adds a directory payer after the others, once, and refuses one not in the directory', async () => {
    const { db, queries } = recording((sql) =>
      sql.startsWith('select "id" from "payers"') ? [{ id: COV }] : []
    );
    const store = createRecoveryStore(db, blobs, boss);
    await store.addPayer('r1', ID, { payerId: COV, memberId: 'M1' });
    const added = queries.find((q) => q.sql.startsWith('insert into "claim_coverages"'));
    assert.ok(added?.sql.includes('coalesce(max(position), 0) + 1'));
    assert.ok(
      added?.sql.includes(
        "on conflict (claim_id, lower(payer_name), lower(coalesce(member_id, ''))) do nothing"
      )
    );
    assert.ok(added?.parameters.includes('M1'));
    const none = createRecoveryStore(recording(() => []).db, blobs, boss);
    await assert.rejects(
      () => none.addPayer('r1', ID, { payerId: COV, memberId: null }),
      /not in the directory/
    );
  });

  it('gathers the claim, report and PDFs for an appeal packet and stores the packet', async () => {
    const { db, queries } = recording((sql) =>
      sql.includes('from "billing_profiles"')
        ? [profile]
        : sql.includes('inner join "claim_coverages"')
          ? [
              {
                number: 12,
                pcr_number: 'PCR-1',
                service_date: '2026-10-01',
                level: 'ALS1',
                emergency: true,
                loaded_miles: '4.2',
                total_cents: 90_000,
                transport_reason: 'A',
                signature: 'signed',
                pcs_signed_on: null,
                first_name: 'Jane',
                last_name: 'Doe',
                birth_date: '1950-01-01',
                member_id: 'M1',
                payer: 'Medicare',
                bucket: 'ugula',
                key: 'imports/r.json'
              }
            ]
          : sql.includes('from "claim_lines"')
            ? [{ code: 'A0427', units: '1', total_cents: 80_000 }]
            : sql.includes('"document" is not null')
              ? [
                  { document: { bucket: 'ugula', key: 'docs/pcs.pdf' } },
                  { document: 'x' },
                  {
                    document: {
                      bucket: 'ugula',
                      key: 'docs/facesheet',
                      contentType: 'application/pdf'
                    }
                  }
                ]
              : []
    );
    const store = createRecoveryStore(db, blobs, boss);
    const source = await store.appealPacket('r1', ID, COV);
    assert.equal(source.payer, 'Medicare');
    assert.deepEqual(source.claim.slice(0, 3), [
      { label: 'Claim', value: '#12' },
      { label: 'PCR', value: 'PCR-1' },
      { label: 'Patient', value: 'Jane Doe' }
    ]);
    assert.equal(source.attachments.length, 2);
    const documents = queries.find((q) => q.sql.includes('"document" is not null'));
    assert.ok(
      documents?.sql.includes('union all select "document", "created_at" from "claim_documents"')
    );
    assert.ok(documents?.parameters.includes('application/pdf'));
    await store.saveAppealPacket('r1', ID, 'step-3', {
      coverageId: COV,
      note: 'Redetermination packet',
      pdf: new Uint8Array([1])
    });
    assert.ok(stored.includes(appealPacketKey('t-1', ID, 'step-3')));
    const saved = queries.find(
      (q) =>
        q.sql.startsWith('insert into "claim_events"') && q.parameters.includes('appeal_packet')
    );
    assert.ok(saved?.parameters.includes(COV));
  });

  it('needs the billing profile for an appeal packet', async () => {
    const { db } = recording((sql) =>
      sql.includes('inner join "claim_coverages"') ? [{ payer: 'Medicare', bucket: null }] : []
    );
    await assert.rejects(
      () => createRecoveryStore(db, blobs, boss).appealPacket('r1', ID, COV),
      /billing profile/
    );
  });
});
