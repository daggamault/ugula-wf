import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import { buildClaim, isLeaseLost } from './run-lease.ts';

describe('buildClaim', () => {
  it('claims only unleased runs in the status each command expects', async () => {
    const db = createDummyDb();
    const sqlFor = (command: Parameters<typeof buildClaim>[1]['command']) =>
      buildClaim(db, { runId: 'r', command }, 1000).compile().sql;
    assert.ok(
      sqlFor({ type: 'advance' }).includes('"lease_until" is null or "lease_until" < now()')
    );
    assert.ok(sqlFor({ type: 'advance' }).includes('"status" = $'));
    assert.ok(
      sqlFor({ type: 'resume', suspensionId: '7', payload: null }).includes(
        `state -> 'suspension' ->> 'id' = $`
      )
    );
    assert.ok(sqlFor({ type: 'cancel' }).includes('"status" in ($'));
    assert.ok(!sqlFor({ type: 'cancel' }).includes('"lease_until" is null'));
    assert.ok(sqlFor({ type: 'advance' }).includes('"lease_token" = gen_random_uuid()'));
    const compiled = buildClaim(db, { runId: 'r', command: { type: 'retry' } }, 1000).compile();
    assert.ok(compiled.parameters.includes('faulted'));
    assert.ok(compiled.sql.includes("interval '1 millisecond'"));
    await db.destroy();
  });
});

describe('isLeaseLost', () => {
  it('tells a lost lease from any other error', () => {
    assert.equal(isLeaseLost(Object.assign(new Error('x'), { code: 'LEASE_LOST' })), true);
    assert.equal(isLeaseLost(new Error('x')), false);
    assert.equal(isLeaseLost('LEASE_LOST'), false);
  });
});
