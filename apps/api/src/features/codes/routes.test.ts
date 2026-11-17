import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createCodeRoutes } from './routes.ts';
import type { CodeService } from './service.ts';

const codes = [{ code: 'R079', description: 'Chest pain, unspecified', is_billable: true }];

const setup = () => {
  const calls: unknown[] = [];
  const service = {
    find: async (query: unknown) => {
      calls.push(query);
      return ok({ codes });
    }
  } as unknown as CodeService;
  return { calls, request: withSession(createCodeRoutes(service)) };
};

describe('code routes', () => {
  it('finds codes of a set by search text', async () => {
    const { calls, request } = setup();
    const res = await request('/?set=icd10cm&q=chest');
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { codes });
    assert.deepEqual(calls, [{ set: 'icd10cm', q: 'chest' }]);
  });

  it('describes a comma separated list of codes', async () => {
    const { calls, request } = setup();
    assert.equal((await request('/?set=rxnorm&codes=1191,7052')).status, 200);
    assert.deepEqual(calls, [{ set: 'rxnorm', codes: ['1191', '7052'] }]);
  });

  it('rejects an unknown set before searching', async () => {
    const { calls, request } = setup();
    const res = await request('/?set=cpt&q=x');
    assert.equal(res.status, 400);
    const body = (await res.json()) as { error: string };
    assert.match(body.error, /^set: Invalid type: Expected \(.+\) but received "cpt"$/);
    assert.deepEqual(calls, []);
  });
});
