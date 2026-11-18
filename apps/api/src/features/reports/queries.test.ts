import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findRemittances, findUnmatchedPayments } from './queries.ts';

const period = { from: '2026-11-01', to: '2026-11-30', payer: 'Blue' };

describe('report queries', () => {
  it('reads the remittances paid in the period by the payer named, oldest first', async () => {
    const { db, queries } = createRecordingDb();
    await findRemittances(db, 't-1', period);
    const [q] = queries;
    assert.match(
      q?.sql ?? '',
      /where "r"\."agency_id" = \$\d+ and coalesce\(r\.paid_on, r\.created_at::date\) >= \$\d+ and coalesce\(r\.paid_on, r\.created_at::date\) <= \$\d+ and lower\(coalesce\(r\.payer_name, ''\)\) like \$\d+/
    );
    assert.match(
      q?.sql ?? '',
      /order by coalesce\(r\.paid_on, r\.created_at::date\), "r"\."created_at" limit \$\d+$/
    );
    assert.deepEqual(q?.parameters.slice(-5), ['t-1', '2026-11-01', '2026-11-30', '%blue%', 1001]);
  });

  it('reads only the payments that matched no claim', async () => {
    const { db, queries } = createRecordingDb();
    await findUnmatchedPayments(db, 't-1', { from: '2026-11-01', to: '2026-11-30' });
    assert.match(queries[0]?.sql ?? '', /and "p"\."claim_id" is null order by/);
    assert.ok(!queries[0]?.sql.includes('like'));
  });
});
