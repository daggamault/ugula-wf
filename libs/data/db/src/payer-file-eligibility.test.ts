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
  it('matches a 271 to the coverage it traces by id, never by casting ids to text', async () => {
    const { db, queries } = createRecordingDb(({ sql, parameters }) =>
      sql.includes('"claim_coverages"."id" = $') && parameters.includes(COVERAGE)
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
  });
});
