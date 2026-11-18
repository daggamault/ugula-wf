import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { createRemittanceService } from './service.ts';

describe('remittance service', () => {
  it('reads a remittance of the agency with its payments', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('from "remittances" as "r"')
        ? [{ id: 'r-1', total_cents: 6_000 }]
        : q.sql.startsWith('select "p"."id"')
          ? [{ id: 'p-1', claim_number: 'c-1' }]
          : []
    );
    const res = await createRemittanceService({ db }).find('t-1', 'r-1');
    assert.deepEqual(res, {
      ok: true,
      value: {
        remittance: { id: 'r-1', total_cents: 6_000 },
        payments: [{ id: 'p-1', claim_number: 'c-1' }]
      }
    });
    for (const q of queries) assert.ok(q.parameters.includes('t-1'), q.sql);
  });

  it('reports a remittance outside the agency as missing', async () => {
    const res = await createRemittanceService({ db: createRecordingDb().db }).find('t-1', 'r-1');
    assert.equal(res.ok ? null : res.failure.code, 'not_found');
  });

  it('searches the remittances of the agency', async () => {
    const { db, queries } = createRecordingDb();
    const res = await createRemittanceService({ db }).search('t-1', {
      q: 'medicare',
      state: ['open'],
      page: 1,
      pageSize: 25,
      sort: 'received',
      dir: 'desc'
    });
    assert.ok(res.ok);
    const [page] = queries;
    assert.match(page?.sql ?? '', /"r"\."agency_id" = \$\d+/);
    assert.match(
      page?.sql ?? '',
      /case when r\.reconciled_at is null then 'open' else 'reconciled' end/
    );
    assert.ok(page?.parameters.includes('%medicare%'));
  });
});
