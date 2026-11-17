import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import type { CompiledQuery } from 'kysely';
import { createClaimService } from './service.ts';

const claim = {
  id: 'c1',
  status: 'needs_review',
  patient_id: 'p1',
  total_cents: 100_000,
  coverages: [{ id: 'cov-1', payer: 'Medicare' }],
  lines: [{ code: 'A0427' }],
  diagnoses: ['I214']
};

const setup = (row: Record<string, unknown> | null = claim) => {
  const { db, queries } = createRecordingDb((q: CompiledQuery) => {
    if (q.sql.includes('from "codes"')) {
      return [{ code_set: 'hcpcs', code: 'A0427', description: 'ALS1 emergency' }];
    }
    if (q.sql.includes('from "claims" as "c"')) return row ? [row] : [];
    return [];
  });
  return { service: createClaimService({ db }), queries };
};

describe('claim service', () => {
  it('returns a claim with the meaning of its codes', async () => {
    const { service, queries } = setup();
    const res = await service.find('t-1', 'c1');
    assert.ok(res.ok);
    assert.deepEqual(res.value.claim, claim);
    assert.deepEqual(res.value.codes, { hcpcs: { A0427: 'ALS1 emergency' } });
    assert.deepEqual(queries[0]?.parameters.slice(-2), ['t-1', 'c1']);
  });

  it('reports a claim outside the agency as missing', async () => {
    const res = await setup(null).service.find('t-2', 'c1');
    assert.equal(res.ok, false);
    assert.deepEqual(res.ok ? null : res.failure, {
      code: 'not_found',
      message: 'Claim not found'
    });
  });

  it('searches the claims of the agency', async () => {
    const { service, queries } = setup();
    const res = await service.search('t-1', {
      page: 1,
      pageSize: 25,
      sort: 'created',
      dir: 'desc',
      status: []
    });
    assert.ok(res.ok);
    assert.equal(queries[0]?.parameters[0], 't-1');
  });
});
