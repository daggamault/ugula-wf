import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createDummyDb } from '@ugula/db/testing';
import type { RunCommand } from '@ugula/run-queue';
import { assertLeased, buildClaim, isLeaseLost } from './run-lease.ts';

const CLAIM =
  'update "workflow_runs" set "status" = $1, "lease_expires_at" = now() + $2 * interval \'1 millisecond\', "lease_token" = gen_random_uuid(), "updated_at" = now() where "id" = $3';

const IDLE = ' and ("lease_expires_at" is null or "lease_expires_at" < now())';

const RETURNING =
  ' returning "id", "lease_token", "agency_id", "graph_version_id", "parent_id", "parent_wait", "inputs", "state", (select coalesce(json_agg(json_build_object(\'id\', g.graph_version_id, \'key\', g.key, \'version\', g.version) order by g.key, g.version), \'[]\') as "graphs" from "workflow_run_graphs" as "g" where "g"."run_id" = "workflow_runs"."id") as "graphs", (select coalesce(json_agg(json_build_object(\'id\', t.table_version_id, \'key\', t.key) order by t.key), \'[]\') as "tables" from "workflow_run_tables" as "t" where "t"."run_id" = "workflow_runs"."id") as "tables"';

describe('buildClaim', () => {
  const db = createDummyDb();
  const claim = (command: RunCommand) => {
    const { sql, parameters } = buildClaim(db, { runId: 'r', command }, 1000).compile();
    return { sql, parameters };
  };

  it('advances only an unleased running run, returning it with its pinned graphs and tables', () => {
    assert.deepEqual(claim({ type: 'advance' }), {
      sql: `${CLAIM}${IDLE} and "status" = $4${RETURNING}`,
      parameters: ['running', 1000, 'r', 'running']
    });
  });

  it('resumes only an unleased suspended run still waiting on the same suspension', () => {
    assert.deepEqual(claim({ type: 'resume', suspensionId: '7', payload: null }), {
      sql: `${CLAIM}${IDLE} and "status" = $4 and state -> 'suspension' ->> 'id' = $5${RETURNING}`,
      parameters: ['running', 1000, 'r', 'suspended', '7']
    });
  });

  it('retries and skips only an unleased faulted run', () => {
    const faulted = {
      sql: `${CLAIM}${IDLE} and "status" = $4${RETURNING}`,
      parameters: ['running', 1000, 'r', 'faulted']
    };
    assert.deepEqual(claim({ type: 'retry' }), faulted);
    assert.deepEqual(claim({ type: 'skip', pin: 'then', outputs: {} }), faulted);
  });

  it('cancels any active run even while another worker holds its lease', () => {
    assert.deepEqual(claim({ type: 'cancel' }), {
      sql: `${CLAIM} and "status" in ($4, $5, $6)${RETURNING}`,
      parameters: ['running', 1000, 'r', 'running', 'suspended', 'faulted']
    });
  });
});

describe('assertLeased', () => {
  it('throws a lost lease when the fenced write touched no row', () => {
    assert.doesNotThrow(() => assertLeased('r1', { numUpdatedRows: 1n }));
    assert.throws(
      () => assertLeased('r1', { numUpdatedRows: 0n }),
      (err: unknown) =>
        isLeaseLost(err) &&
        err instanceof Error &&
        err.message === 'Run r1 is no longer leased by this worker'
    );
  });
});

describe('isLeaseLost', () => {
  it('tells a lost lease from any other error', () => {
    assert.equal(isLeaseLost(Object.assign(new Error('x'), { code: 'LEASE_LOST' })), true);
    assert.equal(isLeaseLost(new Error('x')), false);
    assert.equal(isLeaseLost(Object.assign(new Error('x'), { code: 'ECONNRESET' })), false);
    assert.equal(isLeaseLost('LEASE_LOST'), false);
  });
});
