import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fail, ok } from '../../shared/result.ts';
import { withSession } from '../../shared/testing.ts';
import { createPatientRoutes } from './routes.ts';
import type { PatientService } from './service.ts';

const ID = '01a16617-7704-7ba6-b9b5-9c79fa44f965';

const calls: unknown[][] = [];

const service = {
  list: async (...args: unknown[]) => {
    calls.push(['list', ...args]);
    return ok({ items: [], total: 0, page: 1, pageSize: 25 });
  },
  find: async (...args: unknown[]) => {
    calls.push(['find', ...args]);
    return ok({ patient: { id: ID } });
  }
} as unknown as PatientService;

const request = withSession(createPatientRoutes(service));

describe('patient routes', () => {
  it('search and open patients in the session agency', async () => {
    assert.equal((await request('/?lastName=doe&birthDate=1980-01-02')).status, 200);
    assert.equal((await request(`/${ID}`)).status, 200);
    assert.equal((await request('/?birthDate=yesterday')).status, 400);
    assert.equal((await request('/')).status, 400);
    assert.equal((await request('/?lastName=%20%20')).status, 400);
    assert.equal((await request('/nope')).status, 400);
    assert.deepEqual(calls, [
      [
        'list',
        't-1',
        {
          lastName: 'doe',
          birthDate: '1980-01-02',
          page: 1,
          pageSize: 25,
          sort: 'name',
          dir: 'asc'
        }
      ],
      ['find', 't-1', ID]
    ]);
  });
});

describe('patient route failures', () => {
  it('answers 404 for patients the agency does not have', async () => {
    const missing = {
      find: async () => fail('not_found', 'Patient not found')
    } as unknown as PatientService;
    const res = await withSession(createPatientRoutes(missing))(`/${ID}`);
    assert.equal(res.status, 404);
    assert.deepEqual(await res.json(), { error: 'Patient not found' });
  });
});
