import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createStatementStore, statementKey } from './claim-statements.ts';

const stored: { key: string; size: number; type: string }[] = [];

const blobs = {
  putBytes: async (key: string, body: Uint8Array, contentType: string) => {
    stored.push({ key, size: body.byteLength, type: contentType });
    return { bucket: 'ugula', key, size: body.byteLength, contentType };
  },
  getBytes: async () => new Uint8Array()
};

const ID = '0195f2a4-0000-7000-8000-000000000001';

describe('createStatementStore', () => {
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
          ? [
              {
                code: 'A0427',
                units: '1.00',
                unit_cents: 95_000,
                total_cents: 95_000,
                description: 'ALS1, emergency transport'
              }
            ]
          : responses
    );
    const data = await createStatementStore(db, blobs).statementData('r1', ID);
    assert.equal(data.agency?.name, 'Development EMS');
    assert.equal(data.agency?.timeZone, 'America/Chicago');
    assert.equal(data.patient.name, 'Jane Doe');
    assert.equal(data.serviceDate, '2026-10-01');
    assert.deepEqual(data.lines, [
      {
        code: 'A0427',
        units: 1,
        unitCents: 95_000,
        totalCents: 95_000,
        description: 'ALS1, emergency transport'
      }
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
    assert.equal(
      (await createStatementStore(missing.db, blobs).statementData('r1', ID)).agency,
      null
    );
  });

  it('stores statement PDFs under the agency and logs them once per step', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select') ? [{ id: ID, agency_id: 't-1' }] : []
    );
    await createStatementStore(db, blobs).saveStatement('r1', ID, 'r1:s:stmt:0', {
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
