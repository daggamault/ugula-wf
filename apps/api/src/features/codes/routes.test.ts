import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createCodeRoutes } from './routes.ts';
import type { CodeService } from './service.ts';

const calls: unknown[] = [];

const service = {
  find: async (query: unknown) => {
    calls.push(query);
    return ok({ codes: [] });
  }
} as unknown as CodeService;

const request = withSession(createCodeRoutes(service));

describe('code routes', () => {
  it('finds codes of a set and rejects unknown sets', async () => {
    assert.equal((await request('/?set=icd10cm&q=chest')).status, 200);
    assert.equal((await request('/?set=rxnorm&codes=1191,7052')).status, 200);
    assert.equal((await request('/?set=cpt&q=x')).status, 400);
    assert.deepEqual(calls, [
      { set: 'icd10cm', q: 'chest' },
      { set: 'rxnorm', codes: ['1191', '7052'] }
    ]);
  });
});
