import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fieldSections, SELF } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import { toPcr } from '@ugula/nemsis';
import type { RunQueueClient } from '@ugula/run-queue';
import { appealPacketKey, createRecoveryStore } from './queries.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const COV = '0195f2a4-0000-7000-8000-0000000000c1';

const boss: RunQueueClient = { insert: async () => undefined };

const stored: string[] = [];

const read: unknown[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push(key);
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  },
  getBytes: async (ref: unknown) => {
    read.push(ref);
    return new Uint8Array([read.length]);
  },
  getJson: async () => ({ 'eRecord.01': 'PCR-1' })
};

const CLAIM =
  'select "id", "agency_id" from "claims" where "id" = $1 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $2)';

const sent = (queries: { sql: string; parameters: readonly unknown[] }[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix)).map((q) => [q.sql, q.parameters]);

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
    const before = queries.length;
    await assert.rejects(
      () =>
        store.recordRefund('r1', 'bad', 'k', {
          coverageId: null,
          cents: 1,
          note: '',
          paidOn: '2026-10-31'
        }),
      /Claim bad does not exist/
    );
    assert.equal(queries.length, before);
    assert.deepEqual([queries[0]?.sql, queries[0]?.parameters], [CLAIM, [ID, 'r1']]);
  });

  it('refuses a claim outside the run agency for every recovery step', async () => {
    const { db } = createRecordingDb(() => []);
    const store = createRecoveryStore(db, blobs, boss);
    const missing = new RegExp(`Claim ${ID} does not exist`);
    await assert.rejects(
      () =>
        store.recordRefund('r1', ID, 'k', {
          coverageId: null,
          cents: 1,
          note: '',
          paidOn: '2026-10-31'
        }),
      missing
    );
    await assert.rejects(() => store.skipRemainingPayers('r1', ID, 'k', 'x'), missing);
    await assert.rejects(() => store.addPayer('r1', ID, { payerId: COV, memberId: null }), missing);
    await assert.rejects(() => store.appealPacket('r1', ID, COV), missing);
    await assert.rejects(
      () =>
        store.saveAppealPacket('r1', ID, 'k', { coverageId: COV, note: '', pdf: new Uint8Array() }),
      missing
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
    assert.deepEqual(sent(queries, 'select "id", "status"'), [
      [
        'select "id", "status", "patient_id" from "claims" where "id" = $1 and "agency_id" = $2 for update',
        [ID, 't-1']
      ]
    ]);
    assert.deepEqual(sent(queries, 'select "id" from "claim_events"'), [
      [
        'select "id" from "claim_events" where "claim_id" = $1 and "source_key" = $2',
        [ID, 'step-1']
      ]
    ]);
    assert.deepEqual(sent(queries, 'insert into "claim_events"'), [
      [
        'insert into "claim_events" ("agency_id", "claim_id", "kind", "adjusted_cents", "note", "source_key") values ($1, $2, $3, $4, $5, $6)',
        ['t-1', ID, 'balance_protected', 2_500, 'NH law', 'step-1']
      ],
      [
        `insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "note", "source_key") select "cc"."agency_id", "cc"."claim_id", 'payer_skipped' as "kind", "cc"."id", $1 as "note", $2 || ':' || cc.id as "source_key" from "claim_coverages" as "cc" where "cc"."claim_id" = $3 and not exists (select "e"."id" from "claim_events" as "e" where "e"."coverage_id" = "cc"."id" and "e"."kind" in ($4, $5)) on conflict ("claim_id", "source_key") do nothing`,
        ['Moved to the patient', 'step-2', ID, 'response', 'payer_skipped']
      ]
    ]);
    assert.deepEqual(
      sent(queries, 'insert into "signals"').map(([, parameters]) => parameters),
      [['t-1', `claim:${ID}`, 1]]
    );
  });

  it('protects nothing on a settled claim or a step already recorded, and refuses a closed claim', async () => {
    for (const balance of [0, -1_000]) {
      const settled = protecting('patient_balance', balance);
      await createRecoveryStore(settled.db, blobs, boss).protectBalance('r1', ID, 'k', {
        adjustedCents: 4_000,
        note: 'NH law'
      });
      assert.equal(protections(settled.queries).length, 0);
    }
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
    const draft = protecting('draft', 4_000);
    await assert.rejects(
      () =>
        createRecoveryStore(draft.db, blobs, boss).protectBalance('r1', ID, 'k', {
          adjustedCents: 4_000,
          note: 'NH law'
        }),
      /draft/i
    );
    assert.equal(protections(draft.queries).length, 0);
  });

  it('protects only what was asked when the balance is larger', async () => {
    const { db, queries } = protecting('patient_balance', 9_000);
    await createRecoveryStore(db, blobs, boss).protectBalance('r1', ID, 'k', {
      adjustedCents: 4_000,
      note: 'NH law'
    });
    assert.deepEqual(
      protections(queries).map((q) => q.parameters),
      [['t-1', ID, 'balance_protected', 4_000, 'NH law', 'k']]
    );
  });

  it('adds a directory payer after the others, once, and refuses one not in the directory', async () => {
    const { db, queries } = recording((sql) =>
      sql.startsWith('select "id" from "payers"') ? [{ id: COV }] : []
    );
    const store = createRecoveryStore(db, blobs, boss);
    await store.addPayer('r1', ID, { payerId: COV, memberId: 'M1' });
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [CLAIM, [ID, 'r1']],
        ['select "id" from "payers" where "id" = $1 and "agency_id" = $2', [COV, 't-1']],
        [
          `insert into "claim_coverages" ("agency_id", "claim_id", "position", "payer_name", "payer_id", "member_id", "relationship") select "p"."agency_id", $1::uuid as "claim_id", (select coalesce(max(position), 0) + 1 from claim_coverages where claim_id = $2) as "position", "p"."name", "p"."id", $3::text as "member_id", $4::text as "relationship" from "payers" as "p" where "p"."id" = $5 and "p"."agency_id" = $6 on conflict (claim_id, lower(payer_name), lower(coalesce(member_id, ''))) do nothing`,
          [ID, ID, 'M1', SELF, COV, 't-1']
        ]
      ]
    );
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
    assert.deepEqual(source.report, fieldSections(toPcr({ 'eRecord.01': 'PCR-1' })));
    read.length = 0;
    const again = await store.appealPacket('r1', ID, COV);
    assert.deepEqual(read, [
      { bucket: 'ugula', key: 'docs/pcs.pdf' },
      { bucket: 'ugula', key: 'docs/facesheet', contentType: 'application/pdf' }
    ]);
    assert.deepEqual(again.attachments, [new Uint8Array([1]), new Uint8Array([2])]);
    assert.deepEqual(sent(queries, 'select "document"')[0], [
      `select "document", "created_at" from "claim_events" where "claim_id" = $1 and "document" is not null and "kind" not in ($2, $3, $4, $5) and document ->> 'key' like $6 union all select "document", "created_at" from "claim_documents" where "claim_id" = $7 and document ->> 'contentType' = $8 order by "created_at"`,
      [
        ID,
        'statement',
        'appeal_packet',
        'facility_invoiced',
        'revised',
        '%.pdf',
        ID,
        'application/pdf'
      ]
    ]);
    assert.deepEqual(sent(queries, 'select "l"."code"')[0], [
      'select "l"."code", "l"."units", "l"."total_cents", "d"."description" from "claim_lines" as "l" left join "codes" as "d" on "d"."code_set" = $1 and "d"."code" = "l"."code" where "l"."claim_id" = $2 order by "l"."position"',
      ['hcpcs', ID]
    ]);
    assert.deepEqual(sent(queries, 'select "code" from "claim_diagnoses"')[0], [
      'select "code" from "claim_diagnoses" where "claim_id" = $1 order by "position"',
      [ID]
    ]);
    assert.deepEqual(sent(queries, 'select "c"."number"')[0]?.[1], [COV, ID]);
    await store.saveAppealPacket('r1', ID, 'step-3', {
      coverageId: COV,
      note: 'Redetermination packet',
      pdf: new Uint8Array([1])
    });
    const key = appealPacketKey('t-1', ID, 'step-3');
    assert.equal(stored.at(-1), key);
    assert.deepEqual(sent(queries, 'insert into "claim_events"'), [
      [
        'insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "note", "document", "source_key") values ($1, $2, $3, $4, $5, $6, $7) on conflict ("claim_id", "source_key") do nothing',
        [
          't-1',
          ID,
          'appeal_packet',
          COV,
          'Redetermination packet',
          JSON.stringify({ bucket: 'ugula', key, size: 1, contentType: 'application/pdf' }),
          'step-3'
        ]
      ]
    ]);
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
    assert.equal(
      row?.sql,
      `select "c"."number", "c"."pcr_number", "c"."service_date", "c"."level", "c"."is_emergency", "c"."loaded_miles", "c"."total_cents", "c"."transport_reason", "c"."signature", "c"."pcs_signed_on", "p"."first_name", "p"."last_name", "p"."birth_date", "cc"."member_id", coalesce(dp.name, cc.payer_name) as "payer", r.report ->> 'bucket' as "bucket", "r"."report_key" as "key" from "claims" as "c" left join "patients" as "p" on "p"."id" = "c"."patient_id" left join "import_reports" as "r" on "r"."id" = "c"."import_report_id" inner join "claim_coverages" as "cc" on "cc"."claim_id" = "c"."id" and "cc"."id" = $1 left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" where "c"."id" = $2`
    );
    assert.deepEqual(row?.parameters, [null, ID]);
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
