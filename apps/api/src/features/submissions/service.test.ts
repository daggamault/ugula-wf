import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BatchClaim, ClaimCheck, ClaimEventKind } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { Json } from '@ugula/graph';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import type { Evaluate } from '../../shared/evaluate.ts';
import { recordAnnouncements } from '../../shared/testing.ts';
import type { ReadyClaimRow } from './queries.ts';
import {
  batchKey,
  createSubmissionService,
  detailsOf,
  eligibilityRequests,
  MAP_837P,
  pendingClaim
} from './service.ts';

const toX837 = (c: BatchClaim): Json => ({
  claimId: c.claimId,
  placeOfService: '41',
  frequency: '1',
  payerClaimNumber: c.payerClaimNumber,
  subscriber: {
    relationship: c.payer.relationship,
    memberId: c.payer.memberId,
    groupId: c.payer.groupId
  },
  patient: {
    lastName: c.patient.lastName,
    firstName: c.patient.firstName,
    addressLine: c.patient.addressLine,
    city: c.patient.city,
    state: c.patient.state,
    postalCode: c.patient.postalCode,
    birthDate: c.patient.birthDate,
    sex: c.patient.sex
  },
  payer: { responsibility: 'P', ...c.payer },
  transportReason: 'A',
  loadedMiles: c.loadedMiles,
  conditionCodes: ['09'],
  diagnoses: c.details.diagnoses,
  pickup: c.details.pickup,
  dropoff: c.details.destination,
  lines: c.lines.map((l) => ({
    code: l.code,
    modifiers: [c.details.originDestination],
    chargeCents: l.totalCents,
    units: l.units,
    serviceDate: c.details.serviceDate
  }))
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
  number: 1001,
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

const profile = {
  organization_name: 'Metro EMS',
  npi: '1234567893',
  tax_id: '123456789',
  address_line: '1 Station Rd',
  city: 'Springfield',
  state: 'IL',
  postal_code: '627011234',
  phone: '2175550100',
  submitter_id: 'SUB01',
  receiver_id: 'RCV01',
  receiver_name: 'Demo Clearinghouse',
  production: false
};

const now = new Date('2026-10-23T12:00:00Z');

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

const claimColumns = (row: ReadyClaimRow) => ({
  ...row,
  patient_id: 'p1',
  trip_type: 'emergency',
  level: 'ALS1'
});

const coverageColumns = (row: ReadyClaimRow) =>
  row.coverages.map((c) => ({ ...c, payer_name: c.payer }));

const checkOf = (row: ReadyClaimRow): ClaimCheck => ({
  patientId: 'p1',
  patient: {
    addressLine: row.address_line,
    city: row.city,
    state: row.state,
    postalCode: row.postal_code
  },
  pcrNumber: row.pcr_number,
  tripType: 'emergency',
  level: 'ALS1',
  emergency: row.emergency,
  loadedMiles: row.loaded_miles === null ? null : Number(row.loaded_miles),
  lines: row.lines.map((l) => ({
    code: l.code,
    units: Number(l.units),
    unitCents: l.unit_cents,
    totalCents: l.total_cents
  })),
  totalCents: row.total_cents,
  payers: row.coverages.map((c) => ({
    coverageId: c.id,
    name: c.payer,
    payerId: c.payer_id,
    claimFiling: c.claim_filing,
    memberId: c.member_id,
    relationship: c.relationship,
    insuredFirstName: c.insured_first_name,
    insuredLastName: c.insured_last_name,
    filingLimitDays: null,
    eligibility: null,
    eligibilityNote: null
  })),
  details: detailsOf(row)
});

const pending = (row: ReadyClaimRow, events: EventRow[]) =>
  pendingClaim(row, ledgerOf(events), checkOf(row), now);

describe('pendingClaim', () => {
  it('describes an approved claim waiting on a submission with what blocks it', () => {
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
        [C1, '1001', MEDICARE, false],
        [C2, '1001', MEDICARE, false],
        ['requeued', '1001', MEDICARE, true]
      ]
    );
    assert.deepEqual(waiting[0]?.issues, []);
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
    for (const issue of [
      'The member ID for Medicare is missing',
      'Medicare is not linked to the payer directory',
      'The origin/destination modifier is missing',
      'The date of service is missing'
    ]) {
      assert.ok(waiting[1]?.issues.includes(issue), issue);
    }
    assert.deepEqual(waiting[1]?.warnings, []);
  });

  it('blocks only on blocking issues and ignores payers already skipped', () => {
    const skippedBlue = { ...medicare, id: BLUE, payer: 'Blue Plan', member_id: null };
    const row = claimRow(C1, { pcr_number: null, coverages: [skippedBlue, medicare] });
    const found = pending(row, [
      event(C1, 'payer_skipped', BLUE),
      event(C1, 'approved', MEDICARE, '2026-10-03T00:00:00Z')
    ]);
    assert.equal(found?.coverageId, MEDICARE);
    assert.deepEqual(found?.issues, []);
    assert.equal(found?.warnings.length, 1);
    assert.match(found?.warnings[0] ?? '', /no PCR number/);
  });

  it('notes when anything was logged after the approval', () => {
    const later = pending(claimRow(C1), [
      event(C1, 'approved', MEDICARE),
      { ...event(C1, 'statement', MEDICARE, '2026-10-05T00:00:00Z'), coverage_id: null }
    ]);
    assert.equal(later?.changedSinceApproval, true);
    const fresh = pending(claimRow(C1), [event(C1, 'approved', MEDICARE)]);
    assert.equal(fresh?.changedSinceApproval, false);
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

const setup = ({
  rows = [claimRow(C1)],
  events = [event(C1, 'approved', MEDICARE)] as unknown[],
  withProfile = true,
  broken = false,
  exhausted = false
} = {}) => {
  const opts = { broken };
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('update "billing_profiles"')) {
      return exhausted ? [] : [{ control_number: 7 }];
    }
    if (q.sql.includes('from "billing_profiles"')) return withProfile ? [profile] : [];
    if (q.sql.includes('from "claims" as "c"')) return rows.map(claimColumns);
    if (q.sql.includes('from "claim_events"')) return events;
    if (q.sql.includes('from "claim_lines"')) return rows[0]?.lines ?? [];
    if (q.sql.includes('from "claim_coverages"')) return rows[0] ? coverageColumns(rows[0]) : [];
    if (q.sql.includes('from "claim_diagnoses"')) {
      return (rows[0]?.diagnoses ?? []).map((code) => ({ code }));
    }
    if (q.sql.startsWith('insert into "claim_batches"')) {
      return [{ id: q.parameters[0], control_number: q.parameters[2], claim_count: 1 }];
    }
    if (q.sql.includes('from "workflow_runs"')) return [{ id: 'r1', wait_id: '4' }];
    return [];
  });
  const jobs: unknown[] = [];
  const boss: RunQueueClient = { insert: async (_n, batch) => void jobs.push(...batch) };
  const stored: { key: string; text: string; contentType: string }[] = [];
  const blobs = {
    putBytes: async (key: string, body: Uint8Array, contentType: string) => {
      stored.push({ key, text: new TextDecoder().decode(body), contentType });
      return { bucket: 'b', key, size: body.byteLength, contentType };
    },
    getBytes: async () => new TextEncoder().encode('ISA*')
  };
  const { announce, events: announced } = recordAnnouncements();
  const mapped: string[] = [];
  const evaluate: Evaluate = async (_, tenantId, graph, inputs, output) => {
    mapped.push(`${tenantId}:${graph.key}@${graph.version}:${output}`);
    return inputs.map((i) =>
      opts.broken ? { claimId: 'x' } : toX837(i.claim as unknown as BatchClaim)
    );
  };
  const service = createSubmissionService({ db, boss, blobs, announce, now: () => now, evaluate });
  return { service, queries, jobs, stored, announced, mapped };
};

describe('submission service', () => {
  it('reports profile problems alongside the claims waiting to go out', async () => {
    const { service } = setup({ withProfile: false });
    const res = await service.pending('t1', C1);
    assert.ok(res.ok);
    assert.deepEqual(res.value.issues, ['Add a billing profile in Settings']);
    assert.deepEqual(res.value.claim, {
      id: C1,
      pcrNumber: 'PCR-1',
      patient: 'Jane Doe',
      serviceDate: '2026-10-01',
      payer: 'Medicare',
      totalCents: 92_300,
      resubmission: false,
      issues: [],
      warnings: []
    });
  });

  it('reports no claim when it is not waiting on a submission', async () => {
    const res = await setup({ rows: [] }).service.pending('t1', C1);
    assert.deepEqual(res.ok && res.value.claim, null);
  });

  it('writes an 837P file for one claim, logs it as submitted and wakes its cycle', async () => {
    const { service, queries, jobs, stored, mapped } = setup();
    const res = await service.create('t1', 'u1', C1);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepEqual(mapped, [`t1:${MAP_837P.key}@1:x837`]);
    assert.ok(stored[0]?.text.includes('SV1*HC:A0427:RH*850*UN*1***1~'));
    const batchId = res.ok ? res.value.batch.id : '';
    assert.equal(stored[0]?.key, batchKey('t1', batchId, 7));
    assert.equal(stored[0]?.key, `batches/t1/${batchId}/837P-000000007.txt`);
    assert.equal(stored[0]?.contentType, 'application/edi-x12');
    assert.match(stored[0]?.text ?? '', /^ISA\*00\*/);
    assert.match(stored[0]?.text ?? '', /CLM\*1001\*923\*/);
    const sqls = queries.map((q) => q.sql);
    assert.ok(!sqls.some((s) => s.includes('from "billing_profiles"') && s.endsWith('for update')));
    const locked = sqls.findIndex((s) => s.includes('for update of "c"'));
    const numbered = sqls.findIndex((s) => s.startsWith('update "billing_profiles"'));
    assert.ok(locked >= 0 && numbered > locked);
    const inserted = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(inserted?.parameters.slice(0, 6), [
      C1,
      'submitted',
      MEDICARE,
      '837P file #7',
      batchId,
      'u1'
    ]);
    const status = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.deepEqual(status?.parameters, ['submitted', C1, 'ready']);
    assert.equal(jobs.length, 1);
  });

  it('refuses to write a file once the control numbers are used up', async () => {
    const { service, stored, queries } = setup({ exhausted: true });
    const res = await service.create('t1', 'u1', C1);
    assert.ok(!res.ok && res.failure.code === 'conflict');
    assert.equal(stored.length, 0);
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
  });

  it('refuses claims that are no longer ready, without writing anything', async () => {
    const { service, stored, queries } = setup({
      events: [event(C1, 'approved', MEDICARE), event(C1, 'submitted', MEDICARE)]
    });
    const res = await service.create('t1', 'u1', C1);
    assert.deepEqual(res, {
      ok: false,
      failure: { code: 'conflict', message: 'This claim is not ready to submit' }
    });
    const unreviewed = await setup({ events: [] }).service.create('t1', 'u1', C1);
    assert.ok(!unreviewed.ok && unreviewed.failure.code === 'conflict');
    assert.equal(stored.length, 0);
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
  });

  it('refuses a claim with missing data, naming what to fix', async () => {
    const { service, stored } = setup({ rows: [claimRow(C1, { service_date: null })] });
    const res = await service.create('t1', 'u1', C1);
    assert.ok(!res.ok && res.failure.code === 'invalid');
    assert.equal(!res.ok && res.failure.message, 'The date of service is missing');
    assert.equal(stored.length, 0);
  });

  it('names the claim whose 837P mapping is incomplete, without writing anything', async () => {
    const { service, stored } = setup({ broken: true });
    const res = await service.create('t1', 'u1', C1);
    assert.ok(!res.ok && res.failure.code === 'invalid');
    assert.match(!res.ok ? res.failure.message : '', /Claim 1001: The 837P claim needs/);
    assert.equal(stored.length, 0);
  });

  it('needs clearinghouse IDs before building a batch', async () => {
    const { service } = setup({ withProfile: false });
    const res = await service.create('t1', 'u1', C1);
    assert.ok(!res.ok && res.failure.code === 'invalid');
  });

  it('records a submission made outside a batch for the payer being billed', async () => {
    const { service, queries, jobs } = setup();
    const res = await service.markSubmitted('t1', 'u1', C1, '');
    assert.deepEqual(res, { ok: true, value: { payer: 'Medicare' } });
    const inserted = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(inserted?.parameters.slice(0, 5), [
      C1,
      'submitted',
      MEDICARE,
      'Submitted outside an 837P file',
      null
    ]);
    assert.equal(jobs.length, 1);
    const done = setup({
      events: [event(C1, 'approved', MEDICARE), event(C1, 'submitted', MEDICARE)]
    });
    const again = await done.service.markSubmitted('t1', 'u1', C1, '');
    assert.ok(!again.ok && again.failure.code === 'conflict');
    const paid = setup({
      events: [
        event(C1, 'approved', MEDICARE),
        {
          ...event(C1, 'response', MEDICARE, '2026-10-04T00:00:00Z'),
          coverage_id: null,
          paid_cents: 1_000
        }
      ]
    });
    const changed = await paid.service.markSubmitted('t1', 'u1', C1, '');
    assert.ok(!changed.ok && /since it was approved/.test(changed.failure.message));
    assert.ok(!paid.queries.some((q) => q.sql.startsWith('insert')));
  });
});

describe('eligibility requests', () => {
  const row = {
    number: 1001,
    service_date: null,
    first_name: 'Jane',
    last_name: 'Doe',
    birth_date: '1950-02-03',
    gender: 'F' as const,
    coverages: [
      {
        id: MEDICARE,
        payer: 'Medicare',
        payer_id: 'DEMOMCR',
        member_id: '1EG4TE5MK73',
        relationship: '18',
        insured_first_name: null,
        insured_last_name: null
      },
      {
        id: BLUE,
        payer: 'Blue Plan',
        payer_id: 'BCBS1',
        member_id: 'XYZ1',
        relationship: '19',
        insured_first_name: 'John',
        insured_last_name: 'Doe'
      },
      {
        id: C2,
        payer: 'Unlisted',
        payer_id: null,
        member_id: 'Q',
        relationship: '18',
        insured_first_name: null,
        insured_last_name: null
      }
    ]
  };

  it('asks each linked payer about the patient or the insured, traced by coverage', () => {
    assert.deepEqual(eligibilityRequests(row, '2026-10-31'), [
      {
        trace: MEDICARE,
        payer: { name: 'Medicare', payerId: 'DEMOMCR' },
        subscriber: {
          lastName: 'Doe',
          firstName: 'Jane',
          memberId: '1EG4TE5MK73',
          birthDate: '1950-02-03',
          sex: 'F'
        },
        serviceDate: '2026-10-31'
      },
      {
        trace: BLUE,
        payer: { name: 'Blue Plan', payerId: 'BCBS1' },
        subscriber: {
          lastName: 'Doe',
          firstName: 'John',
          memberId: 'XYZ1',
          birthDate: null,
          sex: null
        },
        serviceDate: '2026-10-31'
      }
    ]);
  });

  it('builds a 270 with a fresh control number, or says what is missing', async () => {
    const built = await setup({
      rows: [{ ...claimRow(C1), ...row } as unknown as ReadyClaimRow]
    }).service.eligibility('t1', C1);
    assert.ok(built.ok && built.value.file.includes('ST*270*0001*005010X279A1'));
    assert.ok(built.ok && built.value.name === 'eligibility-1001-7.x12');
    const none = await setup({ rows: [] }).service.eligibility('t1', C1);
    assert.equal(none.ok ? null : none.failure.code, 'not_found');
    const noProfile = await setup({ withProfile: false }).service.eligibility('t1', C1);
    assert.equal(noProfile.ok ? null : noProfile.failure.code, 'invalid');
  });
});
