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
  it('reads every kind of deadline in one query, dated in the agency time zone, with whether a reminder is open', async () => {
    const { db, queries } = createRecordingDb(() => [
      {
        kind: 'appeal',
        claim_id: 'c1',
        coverage_id: null,
        reference: '20261002-0012 · PCR-1 · Jane Doe',
        due_on: '2026-11-10',
        days_left: 9,
        task_id: TASK,
        priority: 0,
        reminded: false
      }
    ]);
    const [deadline] = await createScheduleStore(db, blobs).deadlines('r1', '2026-11-01');
    assert.deepEqual(deadline, {
      kind: 'appeal',
      claimId: 'c1',
      coverageId: null,
      reference: '20261002-0012 · PCR-1 · Jane Doe',
      dueOn: '2026-11-10',
      daysLeft: 9,
      taskId: TASK,
      priority: 0,
      reminded: false
    });
    const [q] = queries;
    for (const part of ['filing as', 'due as', 'pcs as', 'billing.deadline-reminder']) {
      assert.ok(q?.sql.includes(part) || q?.parameters.includes(part), part);
    }
    assert.ok(q?.parameters.includes('billing.appeal-claim'));
    assert.ok(q?.sql.includes('(t.due_at at time zone a.zone)::date as due_on'));
    assert.ok(!q?.sql.includes('select *'));
  });

  it('files deadlines for drafts and rejected submissions, and reminds once per deadline', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await createScheduleStore(db, blobs).deadlines('r1', '2026-11-01');
    const sql = queries[0]?.sql ?? '';
    assert.ok(sql.includes("c.status in ('draft', 'needs_review', 'ready')"));
    assert.match(sql, /j\.kind = 'rejected'\s+and j\.created_at > e\.created_at/);
    assert.ok(sql.includes("t.status in ('open', 'completed')"));
    assert.ok(sql.includes("r.inputs ->> 'dueOn' = d.due_on::text"));
    assert.ok(
      sql.includes(
        "case when d.kind = 'pcs' then rc.patient_id = d.patient_id else rc.id = d.claim_id end"
      )
    );
    assert.ok(sql.includes('(t.created_at at time zone a.zone)::date > d.due_on'));
  });

  it('raises open tasks only, never lowering them', async () => {
    const { db, queries } = createRecordingDb(() => []);
    const store = createScheduleStore(db, blobs);
    await store.raiseTask('r1', TASK, 3);
    assert.ok(queries[0]?.sql.includes('"priority" < $'));
    await assert.rejects(() => store.raiseTask('r1', 'nope', 3), /does not exist/);
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
    assert.deepEqual(sources[0]?.claims[0]?.patient, 'Doe, Jane');
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
    assert.ok(
      queries.some((q) => q.sql.includes('from "facilities"') && q.sql.endsWith('for update'))
    );
    const [invoice] = inserts(queries, 'facility_invoices');
    assert.ok(invoice?.sql.includes('coalesce(max(i.sequence), 0) + 1'));
    assert.ok(invoice?.sql.includes('on conflict ("agency_id", "source_key") do nothing'));
    assert.deepEqual(inserts(queries, 'facility_invoice_claims')[0]?.parameters, [
      't-1',
      'i1',
      'f1',
      'c1'
    ]);
    assert.ok(inserts(queries, 'claim_events')[0]?.parameters.includes('step:f1:c1'));
    for (const replay of [await run({ inserted: false }), await run({ invoiced: true })]) {
      assert.deepEqual(inserts(replay, 'claim_events'), []);
      assert.deepEqual(inserts(replay, 'facility_invoice_claims'), []);
    }
    assert.ok(stored.includes(invoiceKey('t-1', 'f1', 'step:f1')));
    assert.notEqual(invoiceKey('t-1', 'f1', 'step:f1'), invoiceKey('t-1', 'f1', 'step-2:f1'));
  });

  it('invoices every trip through the month that no invoice to the facility has billed', async () => {
    const { db, queries } = createRecordingDb(({ sql }) =>
      sql.startsWith('select "agency_id"') ? [{ agency_id: 't-1' }] : []
    );
    await createScheduleStore(db, blobs).facilityInvoices('r1', '2026-10-01');
    const trips = queries.find((q) => q.sql.includes('from "claims"'));
    assert.ok(trips?.sql.includes('c.service_date < $'));
    assert.ok(!trips?.sql.includes('c.service_date >= $'));
    assert.ok(
      trips?.sql.includes(
        'not exists (select "l"."claim_id" from "facility_invoice_claims" as "l" where "l"."facility_id" = "f"."id" and "l"."claim_id" = "c"."id")'
      )
    );
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
