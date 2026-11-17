import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { FacilityInvoiceSource } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import { createCalendarStore, createScheduleStore, invoiceKey } from './queries.ts';

const TASK = '0195f2a4-0000-7000-8000-0000000000a1';

const stored: string[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push(key);
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  }
};

const profile = {
  organization_name: 'Metro EMS',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62701',
  phone: '2175550100'
};

const claimRow = (id: string, number: string, facility = 'f1') => ({
  facility_id: facility,
  name: facility === 'f1' ? 'Sunrise SNF' : 'Lakeside Hospital',
  address_line: '5 Elm St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62702',
  id,
  number,
  pcr_number: `PCR-${number}`,
  service_date: '2026-10-02',
  total_cents: 90_000,
  balance_cents: 60_000,
  first_name: 'Jane',
  last_name: 'Doe'
});

describe('createScheduleStore', () => {
  it('reads the facts deadlines are worked out from, dated in the agency time zone', async () => {
    const claim = {
      claim_id: 'c1',
      patient_id: 'p1',
      reference: '20261002-0012 · PCR-1 · Jane Doe'
    };
    const { db, queries } = createRecordingDb(() => [
      {
        filings: [
          {
            ...claim,
            coverage_id: 'cov1',
            claim_filing: 'MB',
            filing_limit_days: null,
            service_date: '2026-10-02'
          }
        ],
        certifications: [{ ...claim, signed_on: '2026-09-15', service_date: '2026-10-02' }],
        tasks: [
          {
            ...claim,
            workflow: 'billing.work-denial',
            due_on: '2026-11-10',
            task_id: TASK,
            priority: 0
          }
        ],
        reminders: [
          {
            kind: 'pcs',
            claim_id: 'c1',
            patient_id: 'p1',
            due_on: '2026-11-14',
            opened_on: '2026-10-31'
          }
        ]
      }
    ]);
    const facts = await createScheduleStore(db, blobs).deadlineFacts('r1', '2026-09-01');
    const reference = '20261002-0012 · PCR-1 · Jane Doe';
    assert.deepEqual(facts, {
      filings: [
        {
          claimId: 'c1',
          patientId: 'p1',
          reference,
          coverageId: 'cov1',
          claimFiling: 'MB',
          filingLimitDays: null,
          serviceDate: '2026-10-02'
        }
      ],
      certifications: [
        {
          claimId: 'c1',
          patientId: 'p1',
          reference,
          signedOn: '2026-09-15',
          serviceDate: '2026-10-02'
        }
      ],
      tasks: [
        {
          workflow: 'billing.work-denial',
          claimId: 'c1',
          patientId: 'p1',
          reference,
          dueOn: '2026-11-10',
          taskId: TASK,
          priority: 0
        }
      ],
      reminders: [
        { kind: 'pcs', claimId: 'c1', patientId: 'p1', dueOn: '2026-11-14', openedOn: '2026-10-31' }
      ]
    });
    assert.equal(queries.length, 1);
    const all = queries[0]?.sql ?? '';
    assert.ok(all.includes('g.key as workflow'));
    assert.ok(all.includes('c.service_date >= $') && queries[0]?.parameters.includes('2026-09-01'));
    assert.ok(all.includes('or c.patient_id in (select patient_id from certifications)'));
    assert.ok(all.includes('(t.due_at at time zone a.zone)::date::text as due_on'));
    assert.ok(all.includes('(t.created_at at time zone a.zone)::date::text as opened_on'));
    assert.ok(!all.includes('select *'));
  });

  it('files deadlines for drafts and rejected submissions, and reads open and done reminders', async () => {
    const { db, queries } = createRecordingDb(() => [
      { filings: [], certifications: [], tasks: [], reminders: [] }
    ]);
    await createScheduleStore(db, blobs).deadlineFacts('r1', '2026-09-01');
    const sql = queries.map((q) => q.sql).join(' ');
    assert.ok(sql.includes("c.status in ('draft', 'needs_review', 'ready')"));
    assert.match(sql, /j\.kind = 'rejected'\s+and j\.created_at > e\.created_at/);
    assert.ok(sql.includes("t.status in ('open', 'completed')"));
    assert.ok(sql.includes("r.inputs ->> 'dueOn' as due_on"));
    assert.ok(!sql.includes('365') && !sql.includes('interval'));
  });

  it('fails clearly when the deadlines query gives no row', async () => {
    const { db } = createRecordingDb(() => []);
    await assert.rejects(
      () => createScheduleStore(db, blobs).deadlineFacts('r1', '2026-09-01'),
      /The deadlines query gave no row/
    );
  });

  it('raises open tasks only, never lowering them', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createScheduleStore(db, blobs);
    await store.raiseTask('r1', TASK, 3);
    assert.deepEqual(
      queries.map((q) => [q.sql, q.parameters]),
      [
        [
          'update "tasks" set "priority" = $1, "updated_at" = now() where "id" = $2 and "agency_id" = (select "agency_id" from "workflow_runs" where "id" = $3) and "status" = $4 and "priority" < $5',
          [3, TASK, 'r1', 'open', 3]
        ]
      ]
    );
    await assert.rejects(() => store.raiseTask('r1', 'nope', 3), /Task nope does not exist/);
    assert.equal(queries.length, 1);
  });

  it('groups the month of open facility trips into one invoice per facility', async () => {
    const { db } = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id" from "workflow_runs"')
        ? [{ agency_id: 't-1' }]
        : sql.includes('from "billing_profiles"')
          ? [profile]
          : sql.includes('from "claims"')
            ? [
                claimRow('c1', '20261002-0012'),
                claimRow('c2', '20261002-0013'),
                claimRow('c3', '20261002-0014', 'f2')
              ]
            : []
    );
    const sources = await createScheduleStore(db, blobs).facilityInvoices('r1', '2026-10-01');
    assert.deepEqual(
      sources.map((s) => [s.facilityId, s.facility[0], s.claims.map((c) => c.number)]),
      [
        ['f1', 'Sunrise SNF', ['20261002-0012', '20261002-0013']],
        ['f2', 'Lakeside Hospital', ['20261002-0014']]
      ]
    );
    assert.deepEqual(sources[0], {
      facilityId: 'f1',
      agency: {
        name: 'Metro EMS',
        addressLine: '1 Main St',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62701',
        phone: '2175550100'
      },
      facility: ['Sunrise SNF', '5 Elm St', 'Springfield, IL 62702'],
      period: '2026-10-01',
      claims: [
        {
          claimId: 'c1',
          number: '20261002-0012',
          pcrNumber: 'PCR-20261002-0012',
          patient: 'Doe, Jane',
          serviceDate: '2026-10-02',
          chargeCents: 90_000,
          balanceCents: 60_000
        },
        {
          claimId: 'c2',
          number: '20261002-0013',
          pcrNumber: 'PCR-20261002-0013',
          patient: 'Doe, Jane',
          serviceDate: '2026-10-02',
          chargeCents: 90_000,
          balanceCents: 60_000
        }
      ]
    });
  });

  it('addresses a facility and names a patient with only the parts on file', async () => {
    const rows = [
      {
        ...claimRow('c1', '20261002-0012'),
        address_line: null,
        city: null,
        state: 'IL',
        postal_code: null,
        first_name: null
      },
      {
        ...claimRow('c2', '20261002-0013', 'f2'),
        address_line: '  ',
        city: 'Springfield',
        state: null,
        postal_code: '62702',
        first_name: null,
        last_name: null
      },
      {
        ...claimRow('c3', '20261002-0014', 'f3'),
        name: 'Hilltop',
        address_line: null,
        city: null,
        state: null,
        postal_code: null
      }
    ];
    const { db } = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id"')
        ? [{ agency_id: 't-1' }]
        : sql.includes('from "billing_profiles"')
          ? [profile]
          : sql.includes('from "claims"')
            ? rows
            : []
    );
    const sources = await createScheduleStore(db, blobs).facilityInvoices('r1', '2026-10-01');
    assert.deepEqual(
      sources.map((s) => [s.facility, s.claims.map((c) => c.patient)]),
      [
        [['Sunrise SNF', 'IL'], ['Doe']],
        [['Lakeside Hospital', 'Springfield 62702'], ['']],
        [['Hilltop'], ['Doe, Jane']]
      ]
    );
  });

  it('refuses to invoice for a run that does not exist', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await assert.rejects(
      () => createScheduleStore(db, blobs).facilityInvoices('gone', '2026-10-01'),
      /no result/i
    );
    assert.equal(queries.length, 1);
  });

  it('needs the billing profile only when there is something to invoice', async () => {
    const none = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id"') ? [{ agency_id: 't-1' }] : []
    );
    assert.deepEqual(
      await createScheduleStore(none.db, blobs).facilityInvoices('r1', '2026-10-01'),
      []
    );
    const missing = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id"')
        ? [{ agency_id: 't-1' }]
        : sql.includes('from "claims"')
          ? [claimRow('c1', '20261002-0012')]
          : []
    );
    await assert.rejects(
      () => createScheduleStore(missing.db, blobs).facilityInvoices('r1', '2026-10-01'),
      /billing profile/
    );
  });

  it('stores an invoice once and logs it on every claim it bills', async () => {
    const source: FacilityInvoiceSource = {
      facilityId: 'f1',
      agency: {
        name: 'Metro EMS',
        addressLine: null,
        city: null,
        state: null,
        postalCode: null,
        phone: '2175550100'
      },
      facility: ['Sunrise SNF'],
      period: '2026-10-01',
      claims: [
        {
          claimId: 'c1',
          number: '20261002-0012',
          pcrNumber: null,
          patient: 'Doe, Jane',
          serviceDate: null,
          chargeCents: 1,
          balanceCents: 1
        }
      ]
    };
    const run = async ({ inserted = true, invoiced = false } = {}) => {
      const { db, queries } = createRecordingDb(({ sql }) =>
        sql.startsWith('select "agency_id"')
          ? [{ agency_id: 't-1' }]
          : sql.startsWith('select "id" from "facilities"')
            ? [{ id: 'f1' }]
            : sql.startsWith('select "claim_id" from "facility_invoice_claims"') && invoiced
              ? [{ claim_id: 'c1' }]
              : sql.startsWith('insert into "facility_invoices"') && inserted
                ? [{ id: 'i1' }]
                : []
      );
      await createScheduleStore(db, blobs).saveFacilityInvoice('r1', 'step:f1', {
        source,
        pdf: new Uint8Array([1]),
        totalCents: 1
      });
      return queries;
    };
    const inserts = (queries: { sql: string; parameters: readonly unknown[] }[], table: string) =>
      queries.filter((q) => q.sql.startsWith(`insert into "${table}"`));
    const queries = await run();
    const document = JSON.stringify({
      bucket: 'ugula',
      key: invoiceKey('t-1', 'f1', 'step:f1'),
      size: 1,
      contentType: 'application/pdf'
    });
    assert.deepEqual(
      queries.slice(1, 3).map((q) => [q.sql, q.parameters]),
      [
        [
          'select "id" from "facilities" where "agency_id" = $1 and "id" = $2 for update',
          ['t-1', 'f1']
        ],
        [
          'select "claim_id" from "facility_invoice_claims" where "facility_id" = $1 and "claim_id" in ($2)',
          ['f1', 'c1']
        ]
      ]
    );
    const [invoice] = inserts(queries, 'facility_invoices');
    assert.match(
      invoice?.sql.replace(/\s+/g, ' ') ?? '',
      /^insert into "facility_invoices" \("agency_id", "facility_id", "period", "sequence", "source_key", "claim_count", "total_cents", "document"\) values \(\$1, \$2, \$3, \( select coalesce\(max\(i\.sequence\), 0\) \+ 1 from facility_invoices i where i\.agency_id = \$4 and i\.facility_id = \$5 and i\.period = \$6 \), \$7, \$8, \$9, \$10\) on conflict \("agency_id", "source_key"\) do nothing returning "id"$/
    );
    assert.deepEqual(invoice?.parameters, [
      't-1',
      'f1',
      '2026-10-01',
      't-1',
      'f1',
      '2026-10-01',
      'step:f1',
      1,
      1,
      document
    ]);
    assert.deepEqual(inserts(queries, 'facility_invoice_claims')[0]?.parameters, [
      't-1',
      'i1',
      'f1',
      'c1'
    ]);
    assert.deepEqual(
      inserts(queries, 'claim_events').map((q) => [q.sql, q.parameters]),
      [
        [
          'insert into "claim_events" ("agency_id", "claim_id", "kind", "note", "document", "source_key") values ($1, $2, $3, $4, $5, $6) on conflict ("claim_id", "source_key") do nothing',
          [
            't-1',
            'c1',
            'facility_invoiced',
            'Facility invoice for 2026-10: $0.01 due',
            document,
            'step:f1:c1'
          ]
        ]
      ]
    );
    for (const replay of [await run({ inserted: false }), await run({ invoiced: true })]) {
      assert.deepEqual(inserts(replay, 'claim_events'), []);
      assert.deepEqual(inserts(replay, 'facility_invoice_claims'), []);
    }
    assert.ok(stored.includes(invoiceKey('t-1', 'f1', 'step:f1')));
    assert.notEqual(invoiceKey('t-1', 'f1', 'step:f1'), invoiceKey('t-1', 'f1', 'step-2:f1'));
  });

  it("refuses to save an invoice for a facility outside the run's agency", async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id"') ? [{ agency_id: 't-1' }] : []
    );
    await assert.rejects(
      () =>
        createScheduleStore(db, blobs).saveFacilityInvoice('r1', 'step:f9', {
          source: {
            facilityId: 'f9',
            agency: {
              name: 'Metro EMS',
              addressLine: null,
              city: null,
              state: null,
              postalCode: null,
              phone: '2175550100'
            },
            facility: ['Elsewhere'],
            period: '2026-10-01',
            claims: []
          },
          pdf: new Uint8Array([1]),
          totalCents: 0
        }),
      /no result/i
    );
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
  });

  it('invoices every trip through the month that no invoice to the facility has billed', async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id"') ? [{ agency_id: 't-1' }] : []
    );
    await createScheduleStore(db, blobs).facilityInvoices('r1', '2026-10-01');
    const trips = queries.find((q) => q.sql.includes('from "claims"'));
    assert.equal(
      trips?.sql,
      `select "f"."id" as "facility_id", "f"."name", "f"."address_line", "f"."city", "f"."state", "f"."postal_code", "c"."id", "c"."number", "c"."pcr_number", "c"."service_date", "c"."total_cents", "b"."balance_cents", "p"."first_name", "p"."last_name" from "claims" as "c" inner join "facilities" as "f" on "f"."id" = "c"."facility_id" inner join "claim_balances" as "b" on "b"."claim_id" = "c"."id" left join "patients" as "p" on "p"."id" = "c"."patient_id" where "c"."agency_id" = $1 and c.status not in ('paid', 'written_off', 'collections', 'void', 'draft') and "b"."balance_cents" > $2 and c.service_date < $3::date + interval '1 month' and not exists (select "l"."claim_id" from "facility_invoice_claims" as "l" where "l"."facility_id" = "f"."id" and "l"."claim_id" = "c"."id") order by "f"."name", "c"."service_date", "c"."number"`
    );
    assert.deepEqual(trips?.parameters, ['t-1', 0, '2026-10-01']);
  });
});

describe('createCalendarStore', () => {
  it("dates a moment by the run agency's time zone", async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id" from "workflow_runs"')
        ? [{ agency_id: 't-1' }]
        : [{ zone: 'America/Chicago' }]
    );
    const calendar = createCalendarStore(db);
    assert.equal(await calendar.today('r1', new Date('2026-11-01T03:00:00Z')), '2026-10-31');
    assert.deepEqual(queries[1]?.parameters, ['t-1']);
    await assert.rejects(
      () => createCalendarStore(createRecordingDb().db).today('r1', new Date()),
      /does not exist/
    );
  });
});
