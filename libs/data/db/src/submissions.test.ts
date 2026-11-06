import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimEventKind } from '@ugula/billing';
import {
  allocateControlNumber,
  batchKey,
  detailsOf,
  findProfile,
  findReadyClaim,
  insertBatch,
  insertSubmissionEvent,
  lockReadyClaim,
  markSubmitted,
  nextBatchClaim,
  pendingClaim,
  type ReadyClaimRow,
  toSubmitter
} from './submissions.ts';
import { createRecordingDb } from './testing.ts';

describe('submission queries', () => {
  it('read one ready claim of the agency, locking it when submitting', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findReadyClaim(db, 't1', 'c1'), undefined);
    await lockReadyClaim(db, 't1', 'c1');
    const [find, lock] = queries;
    assert.ok(
      find?.sql.includes('where "c"."agency_id" = $1 and "c"."id" = $2 and "c"."status" = $3')
    );
    assert.deepEqual(find?.parameters.slice(-3), ['t1', 'c1', 'ready']);
    assert.ok(find?.sql.includes('coalesce(dp.name, cc.payer_name)'));
    assert.ok(lock?.sql.endsWith('for update of "c"'));
    await db.destroy();
  });

  it('allocate control numbers from the billing profile until they run out', async () => {
    const { db, queries } = createRecordingDb(() => [{ control_number: 4 }]);
    assert.equal(await allocateControlNumber(db, 't1'), 4);
    assert.equal(
      queries[0]?.sql,
      'update "billing_profiles" set "next_control_number" = next_control_number + 1 where "agency_id" = $1 and "next_control_number" <= $2 returning next_control_number - 1 as "control_number"'
    );
    assert.deepEqual(queries[0]?.parameters, ['t1', 999_999_999]);
    const used = createRecordingDb(() => []);
    assert.equal(await allocateControlNumber(used.db, 't1'), null);
    await db.destroy();
  });

  it('write the batch, its submission event and move the claim on', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'b1' }]);
    await insertBatch(db, {
      id: 'b1',
      agencyId: 't1',
      controlNumber: 7,
      totalCents: 100,
      production: false,
      document: { key: 'k' },
      createdBy: 'u1'
    });
    await insertSubmissionEvent(
      db,
      { batchId: 'b1', note: '837P file #7', createdBy: null, sourceKey: 'run:step' },
      { claimId: 'c1', kind: 'submitted', coverageId: 'cc1' }
    );
    await markSubmitted(db, 'c1');
    const [batch, event, status] = queries;
    assert.deepEqual(batch?.parameters.slice(0, 4), ['b1', 't1', 7, 1]);
    assert.deepEqual(event?.parameters, [
      'c1',
      'submitted',
      'cc1',
      '837P file #7',
      'b1',
      null,
      'run:step'
    ]);
    assert.ok(status?.sql.startsWith('update "claims" set "status" = $1'));
    assert.deepEqual(status?.parameters, ['submitted', 'c1', 'ready']);
    await db.destroy();
  });
});

const C1 = '01a16617-7704-7ba6-b9b5-9c79fa44f961';
const C2 = '01a16617-7704-7ba6-b9b5-9c79fa44f962';
const MEDICARE = '01a16617-7704-7ba6-b9b5-000000000001';
const BLUE = '01a16617-7704-7ba6-b9b5-000000000002';

const medicare = {
  id: MEDICARE,
  payer: 'Medicare',
  payer_id: 'DEMOMCR',
  claim_filing: 'MB',
  member_id: '1EG4TE5MK73',
  group_id: null,
  relationship: '18',
  insured_first_name: null,
  insured_last_name: null
};

const claimRow = (id: string, over: Partial<ReadyClaimRow> = {}): ReadyClaimRow => ({
  id,
  number: '20261105-1001',
  pcr_number: 'PCR-1',
  emergency: true,
  loaded_miles: '7.3',
  total_cents: 92_300,
  service_date: '2026-10-01',
  origin_code: 'R',
  destination_code: 'H',
  pickup_address_line: '9 Oak Ave',
  pickup_city: 'Springfield',
  pickup_state: 'IL',
  pickup_postal_code: '62702',
  destination_name: 'Mercy',
  destination_address_line: '9 Oak Ave',
  destination_city: 'Springfield',
  destination_state: 'IL',
  destination_postal_code: '62702',
  signature: 'signed',
  signature_note: null,
  pcs_on_file: null,
  pcs_signed_on: null,
  transport_reason: 'A',
  condition_codes: [],
  prior_authorization: null,
  weight_kg: null,
  at_scene_at: new Date('2026-10-01T10:05:00Z'),
  left_scene_at: new Date('2026-10-01T10:25:00Z'),
  at_destination_at: new Date('2026-10-01T10:40:00Z'),
  patient_count: null,
  closest_facility_miles: null,
  abn_on_file: null,
  abn_signed_on: null,
  denial_expected: null,
  msp_employer_plan: null,
  msp_esrd: null,
  msp_disability: null,
  msp_accident: null,
  prior_authorization_expires_on: null,
  pcs_type: null,
  round_trips: null,
  admission_date: null,
  facility_stay: null,
  deceased: false,
  created_at: new Date('2026-10-01T00:00:00Z'),
  first_name: 'Jane',
  last_name: 'Doe',
  birth_date: '1950-02-03',
  gender: 'F',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62704',
  coverages: [medicare],
  lines: [
    { code: 'A0427', units: '1.00', unit_cents: 85_000, total_cents: 85_000 },
    { code: 'A0425', units: '7.30', unit_cents: 1_000, total_cents: 7_300 }
  ],
  diagnoses: ['R079'],
  ...over
});

const event = (
  claimId: string,
  kind: ClaimEventKind,
  coverageId: string | null,
  at = '2026-10-02T00:00:00Z'
) => ({
  claim_id: claimId,
  kind,
  coverage_id: coverageId,
  paid_cents: 0,
  adjusted_cents: 0,
  payer_claim_number: null as string | null,
  paid_on: null as string | null,
  adjustments: [] as { group: 'CO' | 'PR'; reason: string; cents: number }[],
  created_at: new Date(at)
});

type EventRow = ReturnType<typeof event>;

const ledgerOf = (events: EventRow[]) =>
  events.map((e) => ({
    kind: e.kind,
    coverageId: e.coverage_id,
    paidCents: e.paid_cents,
    adjustedCents: e.adjusted_cents,
    payerClaimNumber: e.payer_claim_number,
    paidOn: e.paid_on,
    adjustments: e.adjustments,
    note: '',
    at: e.created_at.toISOString()
  }));

const pending = (row: ReadyClaimRow, events: EventRow[], coverageId = MEDICARE) =>
  pendingClaim(row, ledgerOf(events), coverageId);

describe('pendingClaim', () => {
  it('describes the claim as it goes to the payer being billed, until that payer has it', () => {
    const incomplete = claimRow(C2, {
      service_date: null,
      origin_code: null,
      destination_code: null,
      coverages: [{ ...medicare, member_id: null, payer_id: null, claim_filing: null }],
      diagnoses: []
    });
    const waiting = [
      pending(claimRow(C1), [event(C1, 'approved', MEDICARE)]),
      pending(claimRow('unreviewed'), []),
      pending(incomplete, [event(C2, 'approved', MEDICARE)]),
      pending(claimRow('sent'), [
        event('sent', 'approved', MEDICARE),
        event('sent', 'submitted', MEDICARE)
      ]),
      pending(claimRow('requeued'), [
        event('requeued', 'approved', MEDICARE),
        event('requeued', 'submitted', MEDICARE),
        event('requeued', 'resubmit_queued', MEDICARE, '2026-10-20T00:00:00Z'),
        event('requeued', 'approved', MEDICARE, '2026-10-21T00:00:00Z')
      ])
    ].filter((p) => p !== null);
    assert.deepEqual(
      waiting.map((p) => [p.id, p.claim.claimId, p.coverageId, p.resubmission]),
      [
        [C1, '20261105-1001', MEDICARE, false],
        ['unreviewed', '20261105-1001', MEDICARE, false],
        [C2, '20261105-1001', MEDICARE, false],
        ['requeued', '20261105-1001', MEDICARE, true]
      ]
    );
    assert.equal(waiting[0]?.totalCents, 92_300);
    assert.equal(waiting[0]?.pcrNumber, 'PCR-1');
    assert.deepEqual(waiting[0]?.claim.payer, {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB',
      memberId: '1EG4TE5MK73',
      groupId: null,
      relationship: '18',
      insuredFirstName: null,
      insuredLastName: null
    });
    assert.equal(waiting[0]?.claim.payerClaimNumber, null);
    assert.equal(waiting[0]?.claim.loadedMiles, 7.3);
    assert.deepEqual(waiting[0]?.claim.lines[1], {
      code: 'A0425',
      units: 7.3,
      unitCents: 1_000,
      totalCents: 7_300
    });
  });

  it('is not waiting for a payer that is not the one being billed', () => {
    const skippedBlue = { ...medicare, id: BLUE, payer: 'Blue Plan', member_id: null };
    const row = claimRow(C1, { pcr_number: null, coverages: [skippedBlue, medicare] });
    const events = [
      event(C1, 'payer_skipped', BLUE),
      event(C1, 'approved', MEDICARE, '2026-10-03T00:00:00Z')
    ];
    assert.equal(pending(row, events)?.coverageId, MEDICARE);
    assert.equal(pending(row, events, BLUE), null);
    assert.equal(pending(claimRow(C1, { total_cents: 0 }), []), null);
  });

  it('flags secondary claims, which need the primary payer adjudication', () => {
    const secondary = pending(
      claimRow(C1, { coverages: [{ ...medicare, id: BLUE, payer: 'Blue Plan' }, medicare] }),
      [
        {
          ...event(C1, 'response', BLUE),
          paid_cents: 50_000,
          adjusted_cents: 20_000,
          paid_on: '2026-09-30',
          adjustments: [
            { group: 'CO', reason: '45', cents: 20_000 },
            { group: 'PR', reason: '1', cents: 22_300 }
          ]
        },
        event(C1, 'reconciled', BLUE),
        event(C1, 'approved', MEDICARE)
      ]
    );
    assert.equal(secondary?.coverageId, MEDICARE);
    assert.deepEqual(
      secondary?.claim.priorPayers.map((p) => [p.name, p.paidCents, p.paidOn, p.adjustments]),
      [
        [
          'Blue Plan',
          50_000,
          '2026-09-30',
          [
            { group: 'CO', reason: '45', cents: 20_000 },
            { group: 'PR', reason: '1', cents: 22_300 }
          ]
        ]
      ]
    );
  });
});

describe('pendingClaim payers', () => {
  it('bills an unknown insured relationship as self', () => {
    const relation = (relationship: string) =>
      pending(claimRow(C1, { coverages: [{ ...medicare, relationship }] }), [
        event(C1, 'approved', MEDICARE)
      ])?.claim.payer.relationship;
    assert.equal(relation('01'), '01');
    assert.equal(relation('99'), '18');
  });
});

describe('billing profile', () => {
  it('reads the agency profile as the 837P submitter', async () => {
    const profile = {
      organization_name: 'Metro EMS',
      npi: '1234567893',
      tax_id: '123456789',
      address_line: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postal_code: '62701',
      phone: '2175550100',
      submitter_id: 'S1',
      receiver_id: null,
      receiver_name: null,
      production: true
    };
    const { db, queries } = createRecordingDb(() => [profile]);
    const found = await findProfile(db, 't1');
    assert.deepEqual(queries[0]?.parameters, ['t1']);
    assert.deepEqual(found && toSubmitter(found), {
      organizationName: 'Metro EMS',
      npi: '1234567893',
      taxId: '123456789',
      addressLine: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62701',
      phone: '2175550100',
      submitterId: 'S1',
      receiverId: null,
      receiverName: null,
      production: true
    });
    await db.destroy();
  });

  it('stores each batch under its agency with a zero-padded control number', () => {
    assert.equal(batchKey('t1', 'b1', 42), 'batches/t1/b1/837P-000000042.txt');
  });
});

describe('detailsOf', () => {
  it('rebuilds 837P claim details from the claim columns', () => {
    const details = detailsOf(claimRow(C1));
    assert.equal(details.originDestination, 'RH');
    assert.equal(details.pickup.name, null);
    assert.equal(details.destination.name, 'Mercy');
    assert.deepEqual(details.diagnoses, ['R079']);
    const partial = claimRow(C1, { destination_code: null });
    assert.equal(detailsOf(partial).originDestination, null);
  });
});

describe('nextBatchClaim', () => {
  it('builds the claim for the payer billed next, even after it was sent', () => {
    const sent = [event(C1, 'approved', MEDICARE), event(C1, 'submitted', MEDICARE)];
    const next = nextBatchClaim(claimRow(C1), ledgerOf(sent));
    assert.equal(next?.payer, 'Medicare');
    assert.equal(
      next?.claim.payer.name,
      pending(claimRow(C1), [event(C1, 'approved', MEDICARE)])?.claim.payer.name
    );
    assert.equal(nextBatchClaim(claimRow(C1, { coverages: [] }), []), null);
  });
});
