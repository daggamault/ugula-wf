import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppliedPayerFile, Clearinghouse, RealtimeAnswer } from '@ugula/billing';
import { build277Status } from '@ugula/billing/mock';
import { NOTHING_TO_ASK } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createExchangeStore, statusInquiry } from './exchange.ts';

const CLAIM = '01a16617-7704-7ba6-b9b5-9c79fa44f961';
const COVERAGE = '01a16617-7704-7ba6-b9b5-000000000001';

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
  receiver_id: 'WAYSTAR',
  receiver_name: 'Waystar',
  production: false
};

const patient = {
  number: '20261105-1001',
  service_date: '2026-10-01',
  first_name: 'Jane',
  last_name: 'Doe',
  birth_date: '1950-02-03',
  gender: 'F' as const,
  time_zone: 'America/Chicago'
};

const eligibilityRow = {
  ...patient,
  coverages: [
    {
      id: COVERAGE,
      payer: 'Medicare',
      payer_id: 'DEMOMCR',
      member_id: '1EG4TE5MK73',
      relationship: '18',
      insured_first_name: null,
      insured_last_name: null,
      asked: false
    }
  ]
};

const statusRow: Parameters<typeof statusInquiry>[0] = {
  ...patient,
  total_cents: 125_000,
  member_id: '1EG4TE5MK73',
  relationship: '18',
  insured_first_name: null,
  insured_last_name: null,
  payer: 'Medicare',
  payer_id: 'DEMOMCR',
  payer_claim_number: 'PCN-1',
  submitted: true,
  received: 3
};

type Options = {
  realtime?: RealtimeAnswer | null;
  connected?: boolean;
  withProfile?: boolean;
  submitted?: boolean;
  asked?: boolean;
  readable?: boolean;
};

const setup = ({
  realtime = null,
  connected = true,
  withProfile = true,
  submitted = true,
  asked = false,
  readable = true
}: Options = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "agency_id" from "workflow_runs"')) return [{ agency_id: 't1' }];
    if (q.sql.startsWith('update "billing_profiles"')) return [{ control_number: 7 }];
    if (q.sql.includes('from "billing_profiles"')) return withProfile ? [profile] : [];
    if (q.sql.includes('inner join "claim_coverages" as "cc"'))
      return [{ ...statusRow, submitted }];
    if (q.sql.includes('from "claims" as "c"'))
      return [
        { ...eligibilityRow, coverages: eligibilityRow.coverages.map((c) => ({ ...c, asked })) }
      ];
    return [];
  });
  const uploads: [string, string][] = [];
  const sent: string[] = [];
  const answer = async (x12: string) => {
    sent.push(x12);
    return realtime as RealtimeAnswer;
  };
  const clearinghouse: Clearinghouse = {
    submitClaims: async (name) => name,
    submitEligibility: async (name, bytes) => {
      uploads.push([name, new TextDecoder().decode(bytes)]);
      return `${name}.ELG`;
    },
    submitClaimStatus: async (name, bytes) => {
      uploads.push([name, new TextDecoder().decode(bytes)]);
      return `${name}.CLS`;
    },
    checkEligibility: realtime ? answer : null,
    checkClaimStatus: realtime ? answer : null,
    inbox: async () => assert.fail('no inbox'),
    afterDownload: 'delete'
  };
  const stored: string[] = [];
  const applied: string[] = [];
  const store = createExchangeStore({
    db,
    blobs: {
      putBytes: async (key, body, contentType) => {
        stored.push(key);
        return { bucket: 'b', key, size: body.byteLength, contentType };
      }
    },
    applyDocument: async (_runId, ref, fileName): Promise<AppliedPayerFile> => {
      applied.push(`${fileName}@${ref.key}`);
      if (!readable) return { status: 'unreadable', reason: 'Not a 271' };
      return {
        status: 'applied',
        fileId: 'f1',
        kind: '271',
        envelopeRejection: null,
        reviews: [{ reference: COVERAGE, claimId: CLAIM, outcome: 'review', message: 'MA' }]
      };
    },
    clearinghouseFor: async () => (connected ? clearinghouse : null),
    now: () => new Date('2026-11-04T15:30:00Z')
  });
  const stamped = () =>
    queries.filter((q) =>
      q.sql.startsWith('update "claim_coverages" set "eligibility_requested_at"')
    ).length;
  const reused = () => queries.some((q) => q.sql.includes('update claim_coverages cc set'));
  return { store, uploads, sent, stored, applied, stamped, reused };
};

describe('checkEligibility', () => {
  it('asks in real time and applies the 271 answer like a payer file', async () => {
    const s = setup({ realtime: { ok: true, text: 'ISA*271~' } });
    const r = await s.store.checkEligibility('r1', CLAIM, 'k', false);
    assert.equal(r.status, 'answered');
    assert.equal(r.status === 'answered' && r.fileName, '271-270-000000007-01a16617.x12');
    assert.equal(r.status === 'answered' && r.reviews.length, 1);
    assert.ok(s.sent[0]?.includes('ST*270*0001*005010X279A1'));
    assert.ok(s.sent[0]?.includes(`TRN*1*${COVERAGE}`));
    assert.match(
      s.stored[0] ?? '',
      /^clearinghouse\/t1\/\d+-[0-9a-f]{8}-271-270-000000007-01a16617\.x12$/
    );
    assert.equal(s.uploads.length, 0);
  });

  it('falls back to a batch 270 when real time fails or is not offered', async () => {
    const failed = setup({ realtime: { ok: false, error: 'Timed out' } });
    assert.deepEqual(await failed.store.checkEligibility('r1', CLAIM, 'k', false), {
      status: 'sent',
      sentAs: '270-000000007-01a16617.ELG',
      reason: 'Timed out'
    });
    assert.equal(failed.uploads[0]?.[0], '270-000000007-01a16617');
    const batch = setup();
    assert.deepEqual(await batch.store.checkEligibility('r1', CLAIM, 'k', false), {
      status: 'sent',
      sentAs: '270-000000007-01a16617.ELG',
      reason: null
    });
  });

  it('reuses answers and stamps the payers it asked about', async () => {
    const s = setup();
    await s.store.checkEligibility('r1', CLAIM, 'k', false);
    assert.ok(s.reused());
    assert.equal(s.stamped(), 1);
    const forced = setup();
    await forced.store.checkEligibility('r1', CLAIM, 'k', true);
    assert.equal(forced.reused(), false);
    assert.equal(forced.stamped(), 1);
  });

  it('does not ask again about payers answered or waiting, unless forced', async () => {
    const s = setup({ asked: true });
    assert.deepEqual(await s.store.checkEligibility('r1', CLAIM, 'k', false), {
      status: 'unavailable',
      reason: NOTHING_TO_ASK
    });
    assert.equal(s.uploads.length, 0);
    const forced = setup({ asked: true });
    assert.equal((await forced.store.checkEligibility('r1', CLAIM, 'k', true)).status, 'sent');
  });

  it('does not pay for a batch 270 after a real-time answer that cannot be read', async () => {
    const s = setup({ realtime: { ok: true, text: 'nope' }, readable: false });
    assert.deepEqual(await s.store.checkEligibility('r1', CLAIM, 'k', false), {
      status: 'unavailable',
      reason: 'The real-time answer could not be read: Not a 271'
    });
    assert.equal(s.uploads.length, 0);
    assert.equal(s.stamped(), 1);
  });

  it('says why it cannot ask', async () => {
    const offline = await setup({ connected: false }).store.checkEligibility(
      'r1',
      CLAIM,
      'k',
      false
    );
    assert.match(
      offline.status === 'unavailable' ? offline.reason : '',
      /no clearinghouse connection/
    );
    const noProfile = await setup({ withProfile: false }).store.checkEligibility(
      'r1',
      CLAIM,
      'k',
      false
    );
    assert.equal(noProfile.status, 'unavailable');
    const bad = await setup().store.checkEligibility('r1', 'not-a-claim', 'k', false);
    assert.equal(bad.status, 'unavailable');
  });
});

describe('checkClaimStatus', () => {
  it('asks in real time and logs the 277 answer for the claim', async () => {
    const answer = build277Status([
      { trace: '20261105-1001', claimNumber: '20261105-1001', category: 'A2', code: '20' }
    ]);
    const s = setup({ realtime: { ok: true, text: answer } });
    assert.deepEqual(await s.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
      status: 'answered',
      note: 'In process (A2:20): Accepted into adjudication: Accepted for processing'
    });
    assert.ok(s.sent[0]?.includes('ST*276*0001*005010X212'));
    assert.ok(s.sent[0]?.includes('REF*1K*PCN-1~'));
    assert.equal(s.applied[0], `277-276-000000007-01a16617.x12@${s.stored[0]}`);
  });

  it('falls back to a batch 276 and says how many claim signals were seen', async () => {
    const other = build277Status([{ trace: '9', claimNumber: '9', category: 'A2', code: '20' }]);
    const s = setup({ realtime: { ok: true, text: other } });
    assert.deepEqual(await s.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
      status: 'sent',
      sentAs: '276-000000007-01a16617.CLS',
      reason: 'The answer did not name the claim',
      signalsSeen: 3
    });
    const garbage = setup({ realtime: { ok: true, text: 'nope' } });
    assert.equal((await garbage.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE)).status, 'sent');
  });

  it('asks only about claims submitted to the payer', async () => {
    const r = await setup({ submitted: false }).store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE);
    assert.match(r.status === 'unavailable' ? r.reason : '', /not been submitted/);
  });
});

describe('statusInquiry', () => {
  it('asks about the insured when the patient is a dependent, dated by the agency calendar', () => {
    const dependent = statusInquiry(
      { ...statusRow, relationship: '19', insured_first_name: 'John', insured_last_name: 'Doe' },
      new Date('2026-11-04T12:00:00Z')
    );
    assert.deepEqual(dependent?.subscriber, {
      lastName: 'Doe',
      firstName: 'John',
      birthDate: null,
      sex: null,
      memberId: '1EG4TE5MK73'
    });
    assert.equal(dependent?.patient?.firstName, 'Jane');
    assert.equal(
      statusInquiry({ ...statusRow, member_id: null }, new Date('2026-11-04T12:00:00Z')),
      null
    );
    assert.equal(
      statusInquiry({ ...statusRow, service_date: null }, new Date('2026-11-05T03:00:00Z'))
        ?.serviceDate,
      '2026-11-04'
    );
  });
});
