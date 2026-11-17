import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { AppliedPayerFile, Clearinghouse, RealtimeAnswer } from '@ugula/billing';
import { build277Status } from '@ugula/billing/testing';
import { NO_CHECKABLE_PAYER, NOTHING_TO_ASK } from '@ugula/db';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createExchangeStore, priorCheck, priorEligibility, statusInquiry } from './exchange.ts';

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
      payer_code: 'DEMOMCR',
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
  payer_code: 'DEMOMCR',
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
  prior?: Record<string, unknown>;
  numbers?: boolean;
  duplicate?: boolean;
  profileOf?: Partial<typeof profile>;
  statusOf?: Partial<typeof statusRow> | null;
  eligibilityOf?: Partial<typeof eligibilityRow> | null;
  health?: Record<string, unknown> | null;
};

const setup = ({
  realtime = null,
  connected = true,
  withProfile = true,
  submitted = true,
  asked = false,
  readable = true,
  prior,
  numbers = true,
  duplicate = false,
  profileOf = {},
  statusOf = {},
  eligibilityOf = {},
  health = null
}: Options = {}) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.startsWith('select "agency_id" from "workflow_runs"')) return [{ agency_id: 't1' }];
    if (q.sql.includes('from "clearinghouse_connections"')) return health ? [health] : [];
    if (q.sql.startsWith('update "billing_profiles"'))
      return numbers ? [{ control_number: 7 }] : [];
    if (q.sql.startsWith('select "control_number", "status"')) return prior ? [prior] : [];
    if (q.sql.includes('from "billing_profiles"'))
      return withProfile ? [{ ...profile, ...profileOf }] : [];
    if (q.sql.includes('inner join "claim_coverages" as "cc"'))
      return statusOf ? [{ ...statusRow, submitted, ...statusOf }] : [];
    if (q.sql.includes('from "claims" as "c"'))
      return eligibilityOf
        ? [
            {
              ...eligibilityRow,
              coverages: eligibilityRow.coverages.map((c) => ({ ...c, asked })),
              ...eligibilityOf
            }
          ]
        : [];
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
    applyDocument: async (_runId, _key, ref, fileName): Promise<AppliedPayerFile> => {
      applied.push(`${fileName}@${ref.key}`);
      if (!readable) return { status: 'unreadable', reason: 'Not a 271' };
      if (duplicate) return { status: 'duplicate', fileId: 'f1' };
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
  return { store, uploads, sent, stored, applied, stamped, reused, queries };
};

describe('checkEligibility', () => {
  it('asks in real time and applies the 271 answer like a payer file', async () => {
    const s = setup({ realtime: { ok: true, text: 'ISA*271~' } });
    assert.deepEqual(await s.store.checkEligibility('r1', CLAIM, 'k', false), {
      status: 'answered',
      fileName: '271-270-000000007-01a16617.x12',
      reviews: [{ reference: COVERAGE, claimId: CLAIM, outcome: 'review', message: 'MA' }]
    });
    assert.ok(s.sent[0]?.includes('ST*270*0001*005010X279A1'));
    assert.ok(s.sent[0]?.includes(`TRN*1*${COVERAGE}`));
    assert.match(
      s.stored[0] ?? '',
      /^clearinghouse\/t1\/\d+-[0-9a-f]{8}-271-270-000000007-01a16617\.x12$/
    );
    assert.deepEqual(s.applied, [`271-270-000000007-01a16617.x12@${s.stored[0]}`]);
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

  it('records the request for the run agency and step before asking, then what it sent', async () => {
    const requests = (s: ReturnType<typeof setup>) =>
      s.queries
        .filter((q) => q.sql.includes('"eligibility_requests"'))
        .map((q) => [q.sql, q.parameters]);
    const lookup = [
      'select "control_number", "status", "note", "sent_as", "file_name", "reviews" from "eligibility_requests" where "agency_id" = $1 and "source_key" = $2',
      ['t1', 'k']
    ];
    const insert = [
      'insert into "eligibility_requests" ("agency_id", "claim_id", "source_key", "control_number") values ($1, $2, $3, $4) on conflict ("agency_id", "source_key") do nothing',
      ['t1', CLAIM, 'k', 7]
    ];
    const s = setup({ realtime: { ok: false, error: 'Timed out' } });
    await s.store.checkEligibility('r1', CLAIM, 'k', false);
    assert.deepEqual(requests(s), [
      lookup,
      insert,
      [
        'update "eligibility_requests" set "status" = $1, "sent_as" = $2, "note" = $3 where "agency_id" = $4 and "source_key" = $5',
        ['sent', '270-000000007-01a16617.ELG', 'Timed out', 't1', 'k']
      ]
    ]);
    const answered = setup({ realtime: { ok: true, text: 'ISA*271~' } });
    await answered.store.checkEligibility('r1', CLAIM, 'k', false);
    assert.deepEqual(requests(answered), [
      lookup,
      insert,
      [
        'update "eligibility_requests" set "status" = $1, "file_name" = $2, "reviews" = $3 where "agency_id" = $4 and "source_key" = $5',
        [
          'answered',
          '271-270-000000007-01a16617.x12',
          JSON.stringify([
            { reference: COVERAGE, claimId: CLAIM, outcome: 'review', message: 'MA' }
          ]),
          't1',
          'k'
        ]
      ]
    ]);
  });

  it('returns what a retried step already sent instead of asking again', async () => {
    const reviews = [{ reference: COVERAGE, claimId: CLAIM, outcome: 'review', message: 'MA' }];
    const prior = { control_number: 7, note: null, sent_as: null, file_name: null, reviews: null };
    const answered = setup({
      realtime: { ok: true, text: 'ISA*271~' },
      prior: { ...prior, status: 'answered', file_name: '271-x.x12', reviews }
    });
    assert.deepEqual(await answered.store.checkEligibility('r1', CLAIM, 'k', true), {
      status: 'answered',
      fileName: '271-x.x12',
      reviews
    });
    assert.equal(answered.sent.length, 0);
    const sent = setup({ prior: { ...prior, status: 'sent', sent_as: '270-7.ELG' } });
    assert.deepEqual(await sent.store.checkEligibility('r1', CLAIM, 'k', true), {
      status: 'sent',
      sentAs: '270-7.ELG',
      reason: null
    });
    assert.equal(sent.uploads.length, 0);
    const pending = setup({ prior: { ...prior, control_number: 5, status: 'pending' } });
    await pending.store.checkEligibility('r1', CLAIM, 'k', false);
    assert.equal(pending.uploads[0]?.[0], '270-000000005-01a16617');
    assert.ok(!pending.queries.some((q) => q.sql.startsWith('update "billing_profiles"')));
    assert.ok(!pending.queries.some((q) => q.sql.startsWith('insert into "eligibility_requests"')));
  });

  it('names each reason it cannot ask about eligibility', async () => {
    const reasonOf = async (options: Options, claimId = CLAIM) => {
      const r = await setup(options).store.checkEligibility('r1', claimId, 'k', false);
      return r.status === 'unavailable' ? r.reason : r.status;
    };
    assert.equal(await reasonOf({}, 'not-a-claim'), 'The claim has no patient to ask about yet');
    assert.equal(
      await reasonOf({ connected: false }),
      'The agency has no clearinghouse connection, or it is paused; set one up in Settings or download the request from the claim'
    );
    assert.equal(
      await reasonOf({ eligibilityOf: null }),
      'The claim has no patient to ask about yet'
    );
    assert.equal(await reasonOf({ eligibilityOf: { coverages: [] } }), NO_CHECKABLE_PAYER);
    assert.equal(
      await reasonOf({ numbers: false }),
      'Batch control numbers are used up; contact support'
    );
    assert.equal(
      await reasonOf({ profileOf: { npi: '1234567890' } }),
      'The billing NPI is invalid'
    );
    assert.equal(await reasonOf({ withProfile: false }), 'Add a billing profile in Settings');
  });

  it('answers with no reviews when the real-time 271 was already applied', async () => {
    const s = setup({ realtime: { ok: true, text: 'ISA*271~' }, duplicate: true });
    assert.deepEqual(await s.store.checkEligibility('r1', CLAIM, 'k', false), {
      status: 'answered',
      fileName: '271-270-000000007-01a16617.x12',
      reviews: []
    });
    assert.equal(s.stamped(), 1);
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

  it('falls back to a batch 276 when real time fails, saying how many claim signals were seen', async () => {
    const s = setup({ realtime: { ok: false, error: 'Timed out' } });
    assert.deepEqual(await s.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
      status: 'sent',
      sentAs: '276-000000007-01a16617.CLS',
      reason: 'Timed out',
      signalsSeen: 3
    });
    const settled = s.queries.find((q) => q.sql.startsWith('update "claim_status_requests"'));
    assert.deepEqual(settled?.parameters.slice(0, 4), [
      'sent',
      '276-000000007-01a16617.CLS',
      3,
      'Timed out'
    ]);
  });

  it('does not pay for a batch 276 after a real-time answer that does not name the claim', async () => {
    const other = build277Status([{ trace: '9', claimNumber: '9', category: 'A2', code: '20' }]);
    for (const text of [other, 'nope']) {
      const s = setup({ realtime: { ok: true, text } });
      assert.deepEqual(await s.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
        status: 'unavailable',
        reason: 'The real-time claim status answer did not name the claim'
      });
      assert.equal(s.uploads.length, 0);
    }
  });

  it('returns what a retried step already sent instead of asking again', async () => {
    const sent = setup({
      prior: {
        control_number: 7,
        status: 'sent',
        note: null,
        sent_as: '276-000000007-01a16617.CLS',
        signals_seen: 3
      }
    });
    assert.deepEqual(await sent.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
      status: 'sent',
      sentAs: '276-000000007-01a16617.CLS',
      reason: null,
      signalsSeen: 3
    });
    assert.equal(sent.uploads.length, 0);
    const answered = setup({
      prior: {
        control_number: 7,
        status: 'answered',
        note: 'Paid',
        sent_as: null,
        signals_seen: null
      }
    });
    assert.deepEqual(await answered.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
      status: 'answered',
      note: 'Paid'
    });
    const pending = setup({
      prior: { control_number: 5, status: 'pending', note: null, sent_as: null, signals_seen: null }
    });
    await pending.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE);
    assert.equal(pending.uploads[0]?.[0], '276-000000005-01a16617');
    assert.ok(!pending.queries.some((q) => q.sql.startsWith('update "billing_profiles"')));
    assert.ok(
      !pending.queries.some((q) => q.sql.startsWith('insert into "claim_status_requests"'))
    );
  });

  it('says why it cannot ask about a claim status', async () => {
    const reasonOf = async (options: Options, coverageId = COVERAGE) => {
      const r = await setup(options).store.checkClaimStatus('r1', CLAIM, 'k', coverageId);
      return r.status === 'unavailable' ? r.reason : r.status;
    };
    assert.equal(
      await reasonOf({ statusOf: null }),
      'The payer is not a directory payer on this claim'
    );
    assert.equal(
      await reasonOf({ statusOf: { member_id: null } }),
      'The payer has no member ID or insured to ask about'
    );
    assert.equal(
      await reasonOf({ numbers: false }),
      'Batch control numbers are used up; contact support'
    );
    assert.equal(
      await reasonOf({ profileOf: { submitter_id: '' } }),
      'Add the clearinghouse submitter ID in Settings'
    );
    assert.equal(await reasonOf({ withProfile: false }), 'Add a billing profile in Settings');
    assert.equal(
      await reasonOf({ connected: false }),
      'The agency has no clearinghouse connection, or it is paused; set one up in Settings or download the request from the claim'
    );
    assert.equal(
      await reasonOf({ submitted: false }),
      'The claim has not been submitted to this payer'
    );
  });

  it('looks up only ids that are UUIDs and records the request before asking', async () => {
    const s = setup();
    await s.store.checkClaimStatus('r1', 'claim-1', 'k', 'cov-1');
    const lookup = s.queries.find((q) => q.sql.includes('inner join "claim_coverages" as "cc"'));
    assert.deepEqual(lookup?.parameters.slice(-3), ['t1', null, null]);
    const asked = setup();
    await asked.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE);
    const request = asked.queries.find((q) =>
      q.sql.startsWith('insert into "claim_status_requests"')
    );
    assert.deepEqual(request?.parameters, ['t1', CLAIM, 'k', 7]);
    assert.ok(request?.sql.endsWith('on conflict ("agency_id", "source_key") do nothing'));
  });

  it('counts no claim signals seen when none were ever received', async () => {
    const s = setup({ statusOf: { received: null } });
    assert.deepEqual(await s.store.checkClaimStatus('r1', CLAIM, 'k', COVERAGE), {
      status: 'sent',
      sentAs: '276-000000007-01a16617.CLS',
      reason: null,
      signalsSeen: 0
    });
  });
});

describe('connectionHealth', () => {
  it("reads the poll health of the run agency's own connection", async () => {
    const lastPolledAt = new Date('2026-11-05T11:00:00Z');
    const lastErrorAt = new Date('2026-11-05T12:00:00Z');
    const { store, queries } = setup({
      health: { last_polled_at: lastPolledAt, last_error_at: lastErrorAt, last_error: 'Refused' }
    });
    assert.deepEqual(await store.connectionHealth('run-1'), {
      lastPolledAt,
      lastErrorAt,
      error: 'Refused'
    });
    assert.deepEqual(queries.at(-1)?.parameters, ['t1']);
  });

  it('has no health without a connection of its own', async () => {
    assert.equal(await setup().store.connectionHealth('run-1'), null);
  });
});

describe('priorCheck', () => {
  const request = (status: string, rest: Record<string, unknown> = {}) => ({
    control_number: 7,
    status,
    note: null,
    sent_as: null,
    signals_seen: null,
    ...rest
  });

  it('replays a sent request with blanks for what it did not save', () => {
    assert.deepEqual(priorCheck(request('sent') as never), {
      status: 'sent',
      sentAs: '',
      reason: null,
      signalsSeen: 0
    });
    assert.deepEqual(priorCheck(request('answered') as never), { status: 'answered', note: '' });
  });

  it('replays an unavailable request with its reason, or that the answer did not name the claim', () => {
    assert.deepEqual(priorCheck(request('unavailable', { note: 'Payer down' }) as never), {
      status: 'unavailable',
      reason: 'Payer down'
    });
    assert.deepEqual(priorCheck(request('unavailable') as never), {
      status: 'unavailable',
      reason: 'The real-time claim status answer did not name the claim'
    });
  });
});

describe('priorEligibility', () => {
  const request = (status: string, rest: Record<string, unknown> = {}) =>
    ({
      control_number: 7,
      status,
      note: null,
      sent_as: null,
      file_name: null,
      reviews: null,
      ...rest
    }) as never;

  it('replays an answered request with its file and reviews, or blanks for what it did not save', () => {
    const review = { reference: 'cov-1', message: 'Inactive' };
    assert.deepEqual(
      priorEligibility(request('answered', { file_name: 'a.271', reviews: [review] })),
      { status: 'answered', fileName: 'a.271', reviews: [review] }
    );
    assert.deepEqual(priorEligibility(request('answered')), {
      status: 'answered',
      fileName: '',
      reviews: []
    });
  });

  it('replays a sent request with its name and note', () => {
    assert.deepEqual(
      priorEligibility(request('sent', { sent_as: '270-7.X12', note: 'Real time failed' })),
      { status: 'sent', sentAs: '270-7.X12', reason: 'Real time failed' }
    );
    assert.deepEqual(priorEligibility(request('sent')), {
      status: 'sent',
      sentAs: '',
      reason: null
    });
  });

  it('replays an unavailable request with its reason, or none', () => {
    assert.deepEqual(priorEligibility(request('unavailable', { note: 'Payer down' })), {
      status: 'unavailable',
      reason: 'Payer down'
    });
    assert.deepEqual(priorEligibility(request('unavailable')), {
      status: 'unavailable',
      reason: ''
    });
  });
});

describe('statusInquiry', () => {
  it('cannot ask about a dependent without the insured last name', () => {
    assert.equal(
      statusInquiry(
        { ...statusRow, relationship: '19', insured_first_name: 'John', insured_last_name: null },
        new Date('2026-11-04T12:00:00Z')
      ),
      null
    );
    assert.equal(
      statusInquiry({ ...statusRow, last_name: '' }, new Date('2026-11-04T12:00:00Z')),
      null
    );
  });

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
