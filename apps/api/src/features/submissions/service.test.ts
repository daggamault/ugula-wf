import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { BatchClaim, ClaimEventKind } from '@ugula/billing';
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
  MAP_837P,
  pendingClaims
} from './service.ts';

const toX837 = (c: BatchClaim): Json => ({
  claimId: c.claimId,
  placeOfService: '41',
  frequency: '1',
  subscriber: {
    relationship: '18',
    lastName: c.patient.lastName,
    firstName: c.patient.firstName,
    memberId: c.memberId,
    groupId: c.groupId,
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
  group_id: null
};

const claimRow = (id: string, over: Partial<ReadyClaimRow> = {}): ReadyClaimRow => ({
  id,
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
  postal_code: '62701',
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
  coverageId: string,
  at = '2026-10-02T00:00:00Z'
) => ({
  claim_id: claimId,
  kind,
  coverage_id: coverageId,
  paid_cents: 0,
  adjusted_cents: 0,
  created_at: new Date(at)
});

const pending = (rows: ReadyClaimRow[], events: ReturnType<typeof event>[]) =>
  pendingClaims(rows, events, now);

describe('pendingClaims', () => {
  it('lists approved claims waiting on a submission with what blocks each one', () => {
    const waiting = pending(
      [
        claimRow(C1),
        claimRow('unreviewed'),
        claimRow(C2, {
          service_date: null,
          origin_code: null,
          destination_code: null,
          coverages: [{ ...medicare, member_id: null, payer_id: null, claim_filing: null }],
          diagnoses: []
        }),
        claimRow('sent'),
        claimRow('requeued')
      ],
      [
        event(C1, 'approved', MEDICARE),
        event(C2, 'approved', MEDICARE),
        event('sent', 'approved', MEDICARE),
        event('sent', 'submitted', MEDICARE),
        event('requeued', 'approved', MEDICARE),
        event('requeued', 'submitted', MEDICARE),
        event('requeued', 'resubmit_queued', MEDICARE, '2026-10-20T00:00:00Z'),
        event('requeued', 'approved', MEDICARE, '2026-10-21T00:00:00Z')
      ]
    );
    assert.deepEqual(
      waiting.map((p) => [p.claim.claimId, p.coverageId, p.resubmission]),
      [
        [C1, MEDICARE, false],
        [C2, MEDICARE, false],
        ['requeued', MEDICARE, true]
      ]
    );
    assert.deepEqual(waiting[0]?.issues, []);
    assert.deepEqual(waiting[0]?.claim.payer, {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB'
    });
    assert.equal(waiting[0]?.claim.loadedMiles, 7.3);
    assert.deepEqual(waiting[0]?.claim.lines[1], {
      code: 'A0425',
      units: 7.3,
      unitCents: 1_000,
      totalCents: 7_300
    });
    for (const issue of [
      'The member ID for Medicare is missing',
      'Medicare is not in the payer directory',
      'The origin/destination modifier is missing',
      'The date of service is missing'
    ]) {
      assert.ok(waiting[1]?.issues.includes(issue), issue);
    }
  });

  it('flags secondary claims, which need the primary payer adjudication', () => {
    const [secondary] = pending(
      [claimRow(C1, { coverages: [{ ...medicare, id: BLUE, payer: 'Blue Plan' }, medicare] })],
      [
        { ...event(C1, 'response', BLUE), paid_cents: 50_000 },
        event(C1, 'reconciled', BLUE),
        event(C1, 'approved', MEDICARE)
      ]
    );
    assert.equal(secondary?.coverageId, MEDICARE);
    assert.deepEqual(secondary?.claim.priorPayers, ['Blue Plan']);
    assert.match(secondary?.issues[0] ?? '', /secondary payer/);
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
  broken = false
} = {}) => {
  const opts = { broken };
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "billing_profiles"')) return withProfile ? [profile] : [];
    if (q.sql.includes('from "claims" as "c"')) return rows;
    if (q.sql.includes('from "claim_events"')) return events;
    if (q.sql.includes('max(control_number)')) return [{ next: 7 }];
    if (q.sql.startsWith('insert into "claim_batches"')) {
      return [{ id: 'b1', control_number: 7, claim_count: 1, total_cents: 92_300 }];
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
    const res = await service.pending('t1');
    assert.ok(res.ok);
    assert.deepEqual(res.value.issues, ['Add a billing profile in Settings']);
    assert.deepEqual(res.value.claims[0], {
      id: C1,
      pcrNumber: 'PCR-1',
      patient: 'Jane Doe',
      serviceDate: '2026-10-01',
      payer: 'Medicare',
      totalCents: 92_300,
      resubmission: false,
      issues: []
    });
  });

  it('writes an 837P file for one claim, logs it as submitted and wakes its cycle', async () => {
    const { service, queries, jobs, stored, mapped } = setup();
    const res = await service.create('t1', 'u1', C1);
    assert.ok(res.ok, JSON.stringify(res));
    assert.deepEqual(mapped, [`t1:${MAP_837P.key}@1:x837`]);
    assert.ok(stored[0]?.text.includes('SV1*HC:A0427:RH*850*UN*1***1~'));
    assert.equal(stored[0]?.key, batchKey('t1', 7));
    assert.equal(stored[0]?.key, 'batches/t1/837P-000000007.txt');
    assert.equal(stored[0]?.contentType, 'application/edi-x12');
    assert.match(stored[0]?.text ?? '', /^ISA\*00\*/);
    assert.match(stored[0]?.text ?? '', new RegExp(`CLM\\*${C1}\\*923\\*`));
    const sqls = queries.map((q) => q.sql);
    assert.ok(sqls[0]?.includes('from "billing_profiles"') && sqls[0]?.endsWith('for update'));
    assert.ok(sqls.some((s) => s.includes('for update of "c"')));
    const inserted = queries.find((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.deepEqual(inserted?.parameters.slice(0, 6), [
      C1,
      'submitted',
      MEDICARE,
      '837P file #7',
      'b1',
      'u1'
    ]);
    const status = queries.find((q) => q.sql.startsWith('update "claims"'));
    assert.deepEqual(status?.parameters, ['submitted', C1, 'ready']);
    assert.equal(jobs.length, 1);
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
    assert.match(
      !res.ok ? res.failure.message : '',
      new RegExp(`Claim ${C1}: The 837P claim needs`)
    );
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
  });
});
