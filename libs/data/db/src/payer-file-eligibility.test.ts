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
    const lookups = queries.filter((q) => q.sql.includes('from "claim_coverages"'));
    assert.equal(lookups.length, 1);
    assert.ok(!lookups[0]?.sql.includes('::text'));
    assert.ok(queries.some((q) => q.sql.startsWith('update "claim_coverages"')));
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
    const lookup = queries.find((q) => q.sql.includes('from "claim_coverages"'));
    assert.deepEqual(lookup?.parameters, ['t1', COVERAGE]);
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
