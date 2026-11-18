import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { findRemittance, findRemittancePayments } from './queries.ts';

describe('remittance queries', () => {
  it('reads a remittance with who reconciled it, and its payments in order', async () => {
    const { db, queries } = createRecordingDb();
    await findRemittance(db, 't-1', 'r-1');
    await findRemittancePayments(db, 't-1', 'r-1');
    assert.match(
      queries[0]?.sql ?? '',
      /left join "users" as "u" on "u"."id" = "r"."reconciled_by"/
    );
    assert.match(queries[0]?.sql ?? '', /where "r"\."agency_id" = \$\d+ and "r"\."id" = \$\d+$/);
    assert.match(queries[1]?.sql ?? '', /order by "p"."created_at", "p"."id"$/);
    assert.deepEqual(queries[1]?.parameters, ['t-1', 'r-1']);
  });
});
