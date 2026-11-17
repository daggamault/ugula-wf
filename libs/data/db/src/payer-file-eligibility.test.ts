import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { EligibilityResult } from '@ugula/billing';
import type { RunQueueClient } from '@ugula/run-queue';
import { postEligibility } from './payer-file-eligibility.ts';
import type { Context } from './payer-file-items.ts';
import { createRecordingDb } from './testing.ts';

const boss: RunQueueClient = { insert: async () => undefined };

const COVERAGE = '0195f2a4-0000-7000-8000-0000000000c1';

const result = (trace: string): EligibilityResult => ({
  trace,
  active: true,
  planName: null,
  coverageStart: null,
  coverageEnd: null,
  advantagePlan: null,
  stay: null,
  messages: []
});

describe('payer file eligibility', () => {
  it('matches 271s to the coverages they trace by id in one lookup, never casting ids to text', async () => {
    const { db, queries } = createRecordingDb(({ sql, parameters }) =>
      sql.includes('"claim_coverages"."id" in ($') && parameters.includes(COVERAGE)
        ? [{ id: COVERAGE, claim_id: 'c1', claim_filing: 'MB' }]
        : []
    );
    const c: Context = {
      tx: db,
      boss,
      agencyId: 't1',
      userId: null,
      digest: 'd',
      fileName: 'a.271',
      now: new Date('2026-11-01T00:00:00Z'),
      postings: []
    };
    const out = await postEligibility(c, [result('ABC'), result(COVERAGE.toUpperCase())]);
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.claimId, i.outcome]),
      [
        ['ABC', null, 'unmatched'],
        [COVERAGE.toUpperCase(), 'c1', 'eligible']
      ]
    );
    const [lookup, save, insert] = queries;
    assert.equal(
      lookup?.sql,
      'select "claim_coverages"."id", "claim_coverages"."claim_id", "payers"."claim_filing" from "claim_coverages" left join "payers" on "payers"."id" = "claim_coverages"."payer_id" where "claim_coverages"."agency_id" = $1 and "claim_coverages"."id" in ($2)'
    );
    assert.deepEqual(lookup?.parameters, ['t1', COVERAGE]);
    assert.equal(
      save?.sql,
      'update "claim_coverages" set "eligibility" = $1, "eligibility_note" = $2, "eligibility_checked_at" = $3, "stay_kind" = $4, "stay_admitted_on" = $5, "stay_discharged_on" = $6 where "id" = $7'
    );
    assert.deepEqual(insert?.parameters, [
      't1',
      'c1',
      'eligibility',
      COVERAGE,
      'Coverage active',
      null,
      null,
      'd:2'
    ]);
    assert.equal(queries.filter((q) => q.sql.startsWith('insert into "claim_events"')).length, 1);
  });

  const traced = () => {
    const recording = createRecordingDb(({ sql }) =>
      sql.includes('from "claim_coverages"')
        ? [{ id: COVERAGE, claim_id: 'c1', claim_filing: 'CI' }]
        : []
    );
    const c: Context = {
      tx: recording.db,
      boss,
      agencyId: 't1',
      userId: 'u1',
      digest: 'd',
      fileName: 'a.271',
      now: new Date('2026-11-01T00:00:00Z'),
      postings: []
    };
    return { c, queries: recording.queries };
  };

  const saves = (queries: { sql: string; parameters: readonly unknown[] }[]) =>
    queries.filter((q) => q.sql.startsWith('update "claim_coverages"')).map((q) => q.parameters);

  const events = (queries: { sql: string; parameters: readonly unknown[] }[]) =>
    queries
      .filter((q) => q.sql.startsWith('insert into "claim_events"'))
      .flatMap((q) =>
        Array.from({ length: q.parameters.length / 8 }, (_, i) =>
          q.parameters.slice(i * 8, i * 8 + 8)
        )
      );

  it('saves an active result with its stay and records the label with the note', async () => {
    const { c, queries } = traced();
    const out = await postEligibility(c, [
      {
        ...result(COVERAGE),
        planName: 'Gold',
        coverageStart: '2026-01-01',
        stay: { kind: 'snf', admittedOn: '2026-10-01', dischargedOn: null }
      }
    ]);
    assert.deepEqual(saves(queries), [
      ['active', 'Gold; Covered 2026-01-01 to now', c.now, 'snf', '2026-10-01', null, COVERAGE]
    ]);
    assert.deepEqual(events(queries), [
      [
        't1',
        'c1',
        'eligibility',
        COVERAGE,
        'Coverage active: Gold; Covered 2026-01-01 to now',
        null,
        'u1',
        'd:1'
      ]
    ]);
    assert.deepEqual(out.items, [
      {
        reference: COVERAGE,
        claimId: 'c1',
        outcome: 'eligible',
        message: 'Gold; Covered 2026-01-01 to now',
        paidCents: null,
        adjustedCents: null
      }
    ]);
  });

  it('posts the same file twice under the same keys so the second post adds no event', async () => {
    const { c, queries } = traced();
    await postEligibility(c, [result(COVERAGE)]);
    await postEligibility(c, [result(COVERAGE)]);
    const inserts = queries.filter((q) => q.sql.startsWith('insert into "claim_events"'));
    assert.equal(inserts.length, 2);
    for (const q of inserts) {
      assert.ok(q.sql.endsWith('on conflict ("claim_id", "source_key") do nothing'));
    }
    assert.deepEqual(
      events(queries).map((p) => p[7]),
      ['d:1', 'd:1']
    );
  });

  it('looks nothing up and records nothing when no trace is a coverage id', async () => {
    const { c, queries } = traced();
    const out = await postEligibility(c, [result('PCR-1'), result('')]);
    assert.deepEqual(queries, []);
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.claimId, i.outcome, i.message]),
      [
        ['PCR-1', null, 'unmatched', 'No payer on a claim matches this response'],
        ['', null, 'unmatched', 'No payer on a claim matches this response']
      ]
    );
  });

  it('looks each traced coverage up once however often and in whatever case the file names it', async () => {
    const { c, queries } = traced();
    const out = await postEligibility(c, [result(COVERAGE), result(COVERAGE.toUpperCase())]);
    assert.deepEqual(
      queries.filter((q) => q.sql.includes('from "claim_coverages"')).map((q) => q.parameters),
      [['t1', COVERAGE]]
    );
    assert.deepEqual(
      out.items.map((i) => [i.reference, i.claimId, i.outcome]),
      [
        [COVERAGE, 'c1', 'eligible'],
        [COVERAGE.toUpperCase(), 'c1', 'eligible']
      ]
    );
    assert.deepEqual(
      events(queries).map((p) => p[7]),
      ['d:1', 'd:2']
    );
  });

  it('saves an inactive result with no note or stay as nulls', async () => {
    const { c, queries } = traced();
    const out = await postEligibility(c, [{ ...result(COVERAGE), active: false }]);
    assert.deepEqual(saves(queries), [['inactive', null, c.now, null, null, null, COVERAGE]]);
    assert.deepEqual(
      events(queries).map((p) => p[4]),
      ['Coverage not active']
    );
    assert.deepEqual(
      out.items.map((i) => [i.outcome, i.message]),
      [['ineligible', '']]
    );
  });

  it('leaves the coverage alone when the payer does not say, but still records the answer', async () => {
    const { c, queries } = traced();
    const out = await postEligibility(c, [
      { ...result(COVERAGE), active: null },
      { ...result(COVERAGE), active: null, messages: ['Call the payer'] }
    ]);
    assert.deepEqual(saves(queries), []);
    assert.deepEqual(
      events(queries).map((p) => [p[4], p[7]]),
      [
        ['The payer did not say', 'd:1'],
        ['Call the payer', 'd:2']
      ]
    );
    assert.deepEqual(
      out.items.map((i) => [i.outcome, i.message]),
      [
        ['review', 'The payer did not say'],
        ['review', 'Call the payer']
      ]
    );
  });
});
