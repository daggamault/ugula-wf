import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type ClaimEventKind, createRecordingDb } from '@ugula/db';
import type { JobBoss } from '@ugula/jobs';
import type { CompiledQuery } from 'kysely';
import { batchKey, createSubmissionService, pendingClaims } from './service.ts';

const C1 = '01a16617-7704-7ba6-b9b5-9c79fa44f961';
const C2 = '01a16617-7704-7ba6-b9b5-9c79fa44f962';

const place = { addressLine: '9 Oak Ave', city: 'Springfield', state: 'IL', postalCode: '62702' };

const claimRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  pcr_number: 'PCR-1',
  emergency: true,
  loaded_miles: '7.3',
  lines: [
    { code: 'A0427', units: 1, unitCents: 85_000, totalCents: 85_000 },
    { code: 'A0425', units: 7.3, unitCents: 1_000, totalCents: 7_300 }
  ],
  total_cents: 92_300,
  payers: ['Medicare'],
  coverages: [{ payer: 'Medicare', payerCode: null, memberId: '1EG4TE5MK73', groupId: null }],
  details: {
    serviceDate: '2026-10-01',
    pickup: place,
    destination: { name: 'Mercy', ...place },
    diagnoses: ['R079'],
    originDestination: 'RH'
  },
  created_at: new Date('2026-10-01T00:00:00Z'),
  first_name: 'Jane',
  last_name: 'Doe',
  birth_date: '1950-02-03',
  gender: 'F',
  address_line: '1 Main St',
  city: 'Springfield',
  state: 'IL',
  postal_code: '62704',
  ...over
});

const directory = [{ name: 'medicare', payer_id: 'DEMOMCR', claim_filing: 'MB' }];

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
  payer: string,
  at = '2026-10-02T00:00:00Z'
) => ({
  claim_id: claimId,
  kind,
  payer,
  paid_cents: 0,
  adjusted_cents: 0,
  created_at: new Date(at)
});

describe('pendingClaims', () => {
  it('lists open claims waiting on a submission with what blocks each one', () => {
    const pending = pendingClaims(
      [
        claimRow(C1),
        claimRow(C2, { details: {}, coverages: [] }),
        claimRow('sent'),
        claimRow('requeued')
      ],
      [
        event('sent', 'submitted', 'Medicare'),
        event('requeued', 'submitted', 'Medicare'),
        event('requeued', 'resubmit_queued', 'Medicare', '2026-10-20T00:00:00Z')
      ],
      directory,
      now
    );
    assert.deepEqual(
      pending.map((p) => [p.claim.claimId, p.resubmission]),
      [
        [C1, false],
        [C2, false],
        ['requeued', true]
      ]
    );
    assert.deepEqual(pending[0]?.issues, []);
    assert.deepEqual(pending[0]?.claim.payer, {
      name: 'Medicare',
      payerId: 'DEMOMCR',
      claimFiling: 'MB'
    });
    assert.equal(pending[0]?.claim.loadedMiles, 7.3);
    assert.ok(pending[1]?.issues.includes('The member ID for Medicare is missing'));
    assert.ok(pending[1]?.issues.includes('The origin/destination modifier is missing'));
  });

  it('flags secondary claims, which need the primary payer adjudication', () => {
    const [secondary] = pendingClaims(
      [claimRow(C1, { payers: ['Blue Plan', 'Medicare'] })],
      [{ ...event(C1, 'response', 'Blue Plan'), paid_cents: 50_000 }],
      directory,
      now
    );
    assert.deepEqual(secondary?.claim.priorPayers, ['Blue Plan']);
    assert.match(secondary?.issues[0] ?? '', /secondary payer/);
  });
});

const setup = ({ rows = [claimRow(C1)], events = [] as unknown[], withProfile = true } = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "billing_profiles"')) return withProfile ? [profile] : [];
    if (q.sql.includes('from "claims" as "c"')) return rows;
    if (q.sql.includes('from "claim_events"')) return events;
    if (q.sql.includes('from "payers"')) return directory;
    if (q.sql.includes('max(control_number)')) return [{ next: 7 }];
    if (q.sql.startsWith('insert into "claim_batches"')) {
      return [{ id: 'b1', control_number: 7, claim_count: 1, total_cents: 92_300 }];
    }
    if (q.sql.includes('from "workflow_runs"')) return [{ id: 'r1', wait_id: '4' }];
    return [];
  });
  const jobs: unknown[] = [];
  const boss: JobBoss = { insert: async (_n, batch) => void jobs.push(...batch) };
  const stored: { key: string; text: string; contentType: string }[] = [];
  const blobs = {
    putBytes: async (key: string, body: Uint8Array, contentType: string) => {
      stored.push({ key, text: new TextDecoder().decode(body), contentType });
      return { bucket: 'b', key, size: body.byteLength, contentType };
    },
    getBytes: async () => new TextEncoder().encode('ISA*')
  };
  const service = createSubmissionService({ db, boss, blobs, now: () => now });
  return { service, queries, jobs, stored };
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

  it('writes an 837P file, logs each claim as submitted and wakes its cycle', async () => {
    const { service, queries, jobs, stored } = setup();
    const res = await service.create('t1', 'u1', [C1, C1]);
    assert.ok(res.ok, JSON.stringify(res));
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
      'Medicare',
      '837P batch #7',
      'b1',
      'u1'
    ]);
    assert.equal(jobs.length, 1);
  });

  it('refuses claims that are no longer ready, without writing anything', async () => {
    const { service, stored, queries } = setup({ events: [event(C1, 'submitted', 'Medicare')] });
    const res = await service.create('t1', 'u1', [C1]);
    assert.deepEqual(res, {
      ok: false,
      failure: {
        code: 'conflict',
        message: 'A selected claim is no longer ready to submit',
        details: { claimIds: [C1] }
      }
    });
    assert.equal(stored.length, 0);
    assert.ok(!queries.some((q) => q.sql.startsWith('insert')));
  });

  it('needs clearinghouse IDs before building a batch', async () => {
    const { service } = setup({ withProfile: false });
    const res = await service.create('t1', 'u1', [C1]);
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
      'Medicare',
      'Submitted outside an 837P batch',
      null
    ]);
    assert.equal(jobs.length, 1);
    const done = setup({ events: [event(C1, 'submitted', 'Medicare')] });
    const again = await done.service.markSubmitted('t1', 'u1', C1, '');
    assert.ok(!again.ok && again.failure.code === 'conflict');
  });
});
