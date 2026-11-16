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
    assert.ok(skip?.sql.includes('select "cc"."agency_id", "cc"."claim_id"'));
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
                number: '20261002-0012',
                pcr_number: 'PCR-1',
                service_date: '2026-10-01',
                level: 'ALS1',
                is_emergency: true,
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
    assert.deepEqual(source.claim, [
      { label: 'Claim', value: '20261002-0012' },
      { label: 'PCR', value: 'PCR-1' },
      { label: 'Patient', value: 'Jane Doe' },
      { label: 'Birth date', value: '1950-01-01' },
      { label: 'Member ID', value: 'M1' },
      { label: 'Date of service', value: '2026-10-01' },
      { label: 'Service', value: 'ALS1 emergency' },
      { label: 'Loaded miles', value: '4.2' },
      { label: 'Transport reason', value: 'A' },
      { label: 'Billing signature', value: 'signed' },
      { label: 'A0427', value: 'Ambulance service, 1 units, $800.00' },
      { label: 'Total charges', value: '$900.00' }
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

  it('refuses to protect a balance when the claim is gone by the time it is locked', async () => {
    const { db, queries } = recording(() => []);
    await assert.rejects(
      () =>
        createRecoveryStore(db, blobs, boss).protectBalance('r1', ID, 'k', {
          adjustedCents: 100,
          note: ''
        }),
      new RegExp(`Claim ${ID} does not exist`)
    );
    assert.equal(protections(queries).length, 0);
  });

  it('nudges the claim only when skipping payers recorded something', async () => {
    const skipped = recording((sql) =>
      sql.startsWith('insert into "claim_events"') ? [{}, {}] : []
    );
    await createRecoveryStore(skipped.db, blobs, boss).skipRemainingPayers(
      'r1',
      ID,
      'step-2',
      'Moved to the patient'
    );
    const skip = protections(skipped.queries)[0];
    assert.deepEqual(skip?.parameters.slice(0, 3), ['Moved to the patient', 'step-2', ID]);
    const signal = skipped.queries.find((q) => q.sql.startsWith('insert into "signals"'));
    assert.deepEqual(signal?.parameters, ['t-1', `claim:${ID}`, 1]);
    const none = recording(() => []);
    await createRecoveryStore(none.db, blobs, boss).skipRemainingPayers('r1', ID, 'k', 'x');
    assert.ok(!none.queries.some((q) => q.sql.startsWith('insert into "signals"')));
  });

  it('refuses a payer id that is not a UUID without looking it up', async () => {
    const { db, queries } = recording(() => [{ id: COV }]);
    await assert.rejects(
      () =>
        createRecoveryStore(db, blobs, boss).addPayer('r1', ID, { payerId: 'MCR', memberId: null }),
      /Payer MCR is not in the directory/
    );
    assert.ok(!queries.some((q) => q.sql.includes('from "payers"')));
  });

  it('leaves blank claim fields, the report and unknown line descriptions out of an appeal packet', async () => {
    const { db } = recording((sql) =>
      sql.includes('from "billing_profiles"')
        ? [profile]
        : sql.includes('inner join "claim_coverages"')
          ? [
              {
                number: '20261002-0012',
                pcr_number: null,
                service_date: null,
                level: 'BLS',
                is_emergency: false,
                loaded_miles: null,
                total_cents: 50_000,
                transport_reason: null,
                signature: 'signed',
                pcs_signed_on: '2026-09-30',
                first_name: null,
                last_name: 'Doe',
                birth_date: null,
                member_id: null,
                payer: 'Acme Health',
                bucket: 'ugula',
                key: null
              }
            ]
          : sql.includes('from "claim_lines"')
            ? [
                { code: 'A0428', units: '1', total_cents: 40_000, description: 'BLS transport' },
                { code: 'A0425', units: '2.5', total_cents: 10_000, description: null }
              ]
            : sql.includes('from "claim_diagnoses"')
              ? [{ code: 'R07.9' }, { code: 'I10' }]
              : []
    );
    const source = await createRecoveryStore(db, blobs, boss).appealPacket('r1', ID, COV);
    assert.deepEqual(source.claim, [
      { label: 'Claim', value: '20261002-0012' },
      { label: 'Patient', value: 'Doe' },
      { label: 'Service', value: 'BLS' },
      { label: 'Billing signature', value: 'signed' },
      { label: 'Certification signed', value: '2026-09-30' },
      { label: 'Diagnoses', value: 'R07.9, I10' },
      { label: 'A0428', value: 'BLS transport, 1 units, $400.00' },
      { label: 'A0425', value: 'Ambulance service, 2.5 units, $100.00' },
      { label: 'Total charges', value: '$500.00' }
    ]);
    assert.deepEqual(source.report, []);
    assert.deepEqual(source.attachments, []);
    assert.deepEqual(source.agency, {
      name: 'Metro EMS',
      addressLine: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      phone: '2175550100'
    });
  });

  it('reports a coverage that is not on the claim, matching nothing for an id that is not a UUID', async () => {
    const { db, queries } = recording((sql) =>
      sql.includes('from "billing_profiles"') ? [profile] : []
    );
    await assert.rejects(
      () => createRecoveryStore(db, blobs, boss).appealPacket('r1', ID, 'cov-1'),
      new RegExp(`Payer cov-1 is not on claim ${ID}`)
    );
    const row = queries.find((q) => q.sql.includes('inner join "claim_coverages"'));
    assert.ok(row?.sql.includes('"cc"."id" = $1'));
    assert.equal(row?.parameters[0], null);
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

  it('names an emergency without a level of service without a leading space', async () => {
    const service = async (level: string | null) => {
      const { db } = recording((sql) =>
        sql.includes('from "billing_profiles"')
          ? [profile]
          : sql.includes('inner join "claim_coverages"')
            ? [{ number: 'N1', level, is_emergency: true, signature: 'signed', payer: 'Acme' }]
            : []
      );
      const source = await createRecoveryStore(db, blobs, boss).appealPacket('r1', ID, COV);
      return source.claim.find((r) => r.label === 'Service')?.value;
    };
    assert.equal(await service(null), 'emergency');
    assert.equal(await service('ALS1'), 'ALS1 emergency');
  });
});
