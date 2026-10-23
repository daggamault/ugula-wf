import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db';
import { findClaim, insertResponse, listClaimEvents, listClaims, updatePayers } from './queries.ts';

describe('claim queries', () => {
  it('scope claims to the tenant and derive the balance from the event log', async () => {
    const { db, queries } = createRecordingDb(() => []);
    await listClaims(db, 't-1', { status: 'open', limit: 50 });
    await findClaim(db, 't-1', 'c1');
    await listClaimEvents(db, 'c1');
    assert.equal(await updatePayers(db, 't-1', 'c1', ['Medicare']), false);
    await insertResponse(db, 'c1', 'u1', {
      requestId: 'req-1',
      payer: null,
      paidCents: 5,
      adjustedCents: 0,
      note: ''
    });
    const [list, find, events, update, insert] = queries;
    assert.ok(list?.sql.includes('sum(e.paid_cents + e.adjusted_cents)'));
    assert.ok(list?.sql.includes('"c"."tenant_id" = $1'));
    assert.ok(list?.sql.endsWith('order by "c"."created_at" desc limit $3'));
    assert.ok(find?.sql.includes('"c"."id" = $'));
    assert.ok(
      find?.sql.includes('left join "workflow_runs" as "r" on "r"."id" = "c"."cycle_run_id"')
    );
    assert.ok(events?.sql.endsWith('order by "created_at", "id"'));
    assert.ok(update?.sql.includes('"status" = $'));
    assert.deepEqual(update?.parameters.slice(-3), ['c1', 't-1', 'open']);
    assert.ok(insert?.parameters.includes('response'));
    assert.ok(insert?.sql.includes('on conflict ("claim_id", "source_key") do nothing'));
    await db.destroy();
  });
});
