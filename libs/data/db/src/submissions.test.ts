import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimEventKind } from '@ugula/billing';
import { NoResultError } from 'kysely';
import { documentationOf } from './claim-documentation.ts';
import {
  allocateControlNumber,
  batchKey,
  detailsOf,
  findClaimToBill,
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

const claimColumns = [
  'id',
  'number',
  'pcr_number',
  'is_emergency',
  'loaded_miles',
  'is_deceased',
  'total_cents',
  'service_date',
  'origin_code',
  'destination_code',
  'pickup_address_line',
  'pickup_city',
  'pickup_state',
  'pickup_postal_code',
  'destination_name',
  'destination_address_line',
  'destination_city',
  'destination_state',
  'destination_postal_code',
  'signature',
  'signature_note',
  'has_pcs',
  'pcs_signed_on',
  'transport_reason',
  'condition_codes',
  'prior_authorization',
  'weight_kg',
  'at_scene_at',
  'left_scene_at',
  'at_destination_at',
  'patient_count',
  'closest_facility_miles',
  'has_abn',
  'abn_signed_on',
  'is_denial_expected',
  'has_msp_employer_plan',
  'has_msp_esrd',
  'has_msp_disability',
  'msp_employer_size',
  'msp_accident',
  'prior_authorization_expires_on',
  'pcs_type',
  'round_trips',
  'admitted_on',
  'facility_stay',
  'created_at'
];

const patientColumns = [
  'first_name',
  'last_name',
  'birth_date',
  'gender',
  'address_line',
  'city',
  'state',
  'postal_code'
];

const claimToBillSql = [
  'select',
  [
    ...claimColumns.map((c) => `"c"."${c}"`),
    ...patientColumns.map((c) => `"p"."${c}"`),
    `(select coalesce(json_agg(agg), '[]') from (select "cc"."id", coalesce(dp.name, cc.payer_name) as "payer", "dp"."payer_code", "dp"."claim_filing", "dp"."correction_method", "cc"."member_id", "cc"."group_id", cc.relationship as "relationship", "cc"."insured_first_name", "cc"."insured_last_name" from "claim_coverages" as "cc" left join "payers" as "dp" on "dp"."id" = "cc"."payer_id" where "cc"."claim_id" = "c"."id" order by "cc"."position") as agg) as "coverages"`,
    `(select coalesce(json_agg(agg), '[]') from (select "l"."code", "l"."units", "l"."unit_cents", "l"."total_cents" from "claim_lines" as "l" where "l"."claim_id" = "c"."id" order by "l"."position") as agg) as "lines"`,
    'array((select "d"."code" from "claim_diagnoses" as "d" where "d"."claim_id" = "c"."id" order by "d"."position")) as "diagnoses"'
  ].join(', '),
  'from "claims" as "c" inner join "patients" as "p" on "p"."id" = "c"."patient_id" where "c"."agency_id" = $1 and "c"."id" = $2'
].join(' ');

describe('submission queries', () => {
  it('read one claim of the agency with its coverages, lines and diagnoses in order', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findClaimToBill(db, 't1', 'c1'), undefined);
    assert.equal(queries[0]?.sql, claimToBillSql);
    assert.deepEqual(queries[0]?.parameters, ['t1', 'c1']);
    await db.destroy();
  });

  it('read only a claim a payer can be filed from, locking it when submitting', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await findReadyClaim(db, 't1', 'c1'), undefined);
    assert.equal(await lockReadyClaim(db, 't1', 'c1'), undefined);
    const [find, lock] = queries;
    const ready = `${claimToBillSql} and "c"."status" in ($3, $4, $5, $6)`;
    assert.equal(find?.sql, ready);
    assert.equal(lock?.sql, `${ready} for update of "c"`);
    for (const q of [find, lock]) {
      assert.deepEqual(q?.parameters, ['t1', 'c1', 'ready', 'denied', 'reconcile', 'follow_up']);
    }
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
    await used.db.destroy();
  });

  it('write the batch, its submission event and move the claim on', async () => {
    const row = {
      id: 'b1',
      control_number: 7,
      claim_count: 1,
      total_cents: 100,
      is_production: false,
      created_at: new Date('2026-10-02T00:00:00Z')
    };
    const { db, queries } = createRecordingDb(() => [row]);
    assert.deepEqual(
      await insertBatch(db, {
        id: 'b1',
        agencyId: 't1',
        controlNumber: 7,
        totalCents: 100,
        production: false,
        document: { key: 'k' },
        createdBy: 'u1'
      }),
      row
    );
    await insertSubmissionEvent(
      db,
      { batchId: 'b1', note: '837P file #7', createdBy: null, sourceKey: 'run:step' },
      { agencyId: 't1', claimId: 'c1', kind: 'submitted', coverageId: 'cc1' }
    );
    await markSubmitted(db, 'c1');
    const [batch, event, status] = queries;
    assert.equal(
      batch?.sql,
      'insert into "claim_batches" ("id", "agency_id", "control_number", "claim_count", "total_cents", "is_production", "document", "created_by_id") values ($1, $2, $3, $4, $5, $6, $7, $8) returning "id", "control_number", "claim_count", "total_cents", "is_production", "created_at"'
    );
    assert.deepEqual(batch?.parameters, ['b1', 't1', 7, 1, 100, false, '{"key":"k"}', 'u1']);
    assert.equal(
      event?.sql,
      'insert into "claim_events" ("agency_id", "claim_id", "kind", "coverage_id", "note", "batch_id", "created_by_id", "source_key") values ($1, $2, $3, $4, $5, $6, $7, $8)'
    );
    assert.deepEqual(event?.parameters, [
      't1',
      'c1',
      'submitted',
      'cc1',
      '837P file #7',
      'b1',
      null,
      'run:step'
    ]);
    assert.equal(
      status?.sql,
      'update "claims" set "status" = $1, "updated_at" = now() where "id" = $2 and "status" = $3'
    );
    assert.deepEqual(status?.parameters, ['submitted', 'c1', 'ready']);
    await db.destroy();
  });

  it('fail when the batch is not written', async () => {
    const { db } = createRecordingDb(() => []);
    await assert.rejects(
      insertBatch(db, {
        id: 'b1',
        agencyId: 't1',
        controlNumber: 7,
        totalCents: 100,
        production: true,
        document: {},
        createdBy: null
      }),
      NoResultError
    );
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
  payer_code: 'DEMOMCR',
  claim_filing: 'MB' as const,
  correction_method: 'reopening' as const,
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
  is_emergency: true,
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
  has_pcs: null,
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
  has_abn: null,
  abn_signed_on: null,
  is_denial_expected: null,
  has_msp_employer_plan: null,
  has_msp_esrd: null,
  has_msp_disability: null,
  msp_employer_size: null,
  msp_accident: null,
  prior_authorization_expires_on: null,
  pcs_type: null,
  round_trips: null,
  admitted_on: null,
  facility_stay: null,
  is_deceased: false,
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
      coverages: [{ ...medicare, member_id: null, payer_code: null, claim_filing: null }],
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
    assert.deepEqual(
      [waiting[0]?.claim.payerClaimNumber, waiting[0]?.claim.correctionMethod],
      [null, 'reopening']
    );
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

describe('pendingClaim lines', () => {
  it('sends no loaded miles when the trip has none, and the coverage correction method', () => {
    const none = pending(claimRow(C1, { loaded_miles: null }), [
      event(C1, 'approved', MEDICARE)
    ])?.claim;
    assert.deepEqual(
      [none?.loadedMiles, none?.correctionMethod, none?.lines.map((l) => l.units)],
      [null, 'reopening', [1, 7.3]]
    );
  });

  it('files a non-emergency trip of a deceased patient without a correction method', () => {
    const claim = pending(
      claimRow(C1, {
        is_emergency: null,
        is_deceased: true,
        coverages: [{ ...medicare, correction_method: null }]
      }),
      [event(C1, 'approved', MEDICARE)]
    )?.claim;
    assert.deepEqual(
      [claim?.emergency, claim?.deceased, claim?.correctionMethod],
      [false, true, null]
    );
  });

  it('describes the patient as on the claim', () => {
    assert.deepEqual(pending(claimRow(C1), [event(C1, 'approved', MEDICARE)])?.claim.patient, {
      firstName: 'Jane',
      lastName: 'Doe',
      birthDate: '1950-02-03',
      sex: 'F',
      addressLine: '1 Main St',
      city: 'Springfield',
      state: 'IL',
      postalCode: '62704'
    });
  });
});

describe('manual submission events', () => {
  it('records no source key when none is given', async () => {
    const { db, queries } = createRecordingDb();
    await insertSubmissionEvent(
      db,
      { batchId: null, note: 'Sent by hand', createdBy: 'u1' },
      { agencyId: 't1', claimId: 'c1', kind: 'submitted', coverageId: 'cc1' }
    );
    assert.deepEqual(queries[0]?.parameters, [
      't1',
      'c1',
      'submitted',
      'cc1',
      'Sent by hand',
      null,
      'u1',
      null
    ]);
    await db.destroy();
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
      is_production: true
    };
    const { db, queries } = createRecordingDb(() => [profile]);
    const found = await findProfile(db, 't1');
    assert.equal(
      queries[0]?.sql,
      'select "organization_name", "npi", "tax_id", "address_line", "city", "state", "postal_code", "phone", "submitter_id", "receiver_id", "receiver_name", "is_production" from "billing_profiles" where "agency_id" = $1'
    );
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

  it('finds no profile for an agency that has none', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findProfile(db, 't1'), undefined);
    await db.destroy();
  });

  it('stores each batch under its agency with a zero-padded control number', () => {
    assert.equal(batchKey('t1', 'b1', 42), 'batches/t1/b1/837P-000000042.txt');
  });
});

describe('detailsOf', () => {
  it('rebuilds 837P claim details from the claim columns', () => {
    const row = claimRow(C1);
    assert.deepEqual(detailsOf(row), {
      serviceDate: '2026-10-01',
      pickup: {
        name: null,
        addressLine: '9 Oak Ave',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62702'
      },
      destination: {
        name: 'Mercy',
        addressLine: '9 Oak Ave',
        city: 'Springfield',
        state: 'IL',
        postalCode: '62702'
      },
      diagnoses: ['R079'],
      originDestination: 'RH',
      documentation: documentationOf(row)
    });
  });

  it('sends no origin and destination unless both codes are known', () => {
    assert.equal(detailsOf(claimRow(C1, { destination_code: null })).originDestination, null);
    assert.equal(detailsOf(claimRow(C1, { origin_code: null })).originDestination, null);
  });
});

describe('nextBatchClaim', () => {
  it('builds the claim for the payer billed next, even after it was sent', () => {
    const sent = [event(C1, 'approved', MEDICARE), event(C1, 'submitted', MEDICARE)];
    const next = nextBatchClaim(claimRow(C1), ledgerOf(sent));
    assert.equal(next?.payer, 'Medicare');
    assert.deepEqual(next?.claim, pending(claimRow(C1), [event(C1, 'approved', MEDICARE)])?.claim);
    assert.equal(nextBatchClaim(claimRow(C1, { coverages: [] }), []), null);
  });
});
