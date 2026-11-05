import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createLedgerStore } from './claim-ledger.ts';

const ID = '0195f2a4-0000-7000-8000-000000000001';

const owned = { id: ID, agency_id: 't-1' };

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "agency_id" from "claims"');

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createLedgerStore', () => {
  it('notes revisions with the new report and returns the status and the report it was billed from', async () => {
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.startsWith('select "c"."status"')
          ? [{ status: 'submitted', bucket: 'ugula', key: 'imports/t/f.xml.reports/00000.json' }]
          : []
    );
    const store = createLedgerStore(db);
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
          note: 'ICN 1',
          route: null,
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
