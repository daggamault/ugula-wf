import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { ClaimPatch } from '@ugula/billing';
import { createRecordingDb } from '@ugula/db/testing';
import type { RunJob, RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import { createCycleStore } from './claim-cycle.ts';

const jobs: RunJob[] = [];

const boss: RunQueueClient = {
  insert: async (_, inserted) => {
    jobs.push(...inserted.map((j) => j.data as RunJob));
  }
};

const ID = '0195f2a4-0000-7000-8000-000000000001';

const owned = { id: ID, agency_id: 't-1' };

const CYCLE = '0195f2a4-0000-7000-8000-0000000000c1';

const ownedClaim = (q: CompiledQuery) => q.sql.startsWith('select "id", "agency_id" from "claims"');

const sqlOf = (queries: readonly CompiledQuery[], prefix: string) =>
  queries.filter((q) => q.sql.startsWith(prefix));

describe('createCycleStore', () => {
  it('writes the cycle status only while the claim signals match the ledger it came from', async () => {
    let received = 4;
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q) ? [owned] : q.sql.includes('with current as') ? [{ received }] : []
    );
    const store = createCycleStore(db, boss);
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 4), 'set');
    const write = queries.find((q) => q.sql.includes('with current as'));
    assert.ok(write?.sql.includes('(select received from current) = $'));
    assert.ok(write?.sql.includes('and status <> $'));
    assert.deepEqual(
      write?.parameters.filter((x) => typeof x === 'string' && x !== ID),
      [
        't-1',
        `claim:${ID}`,
        'submitted',
        'submitted',
        'draft',
        'paid',
        'written_off',
        'collections',
        'void'
      ]
    );
    assert.ok(write?.parameters.includes(4));
    received = 5;
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 4), 'stale');
    assert.equal(await store.setStatus('r1', ID, 'k', 'submitted', 5), 'set');
  });

  it('reads a claim check for the run agency', async () => {
    const { db, queries } = createRecordingDb((q) =>
      q.sql.startsWith('select "agency_id" from "workflow_runs"') ? [{ agency_id: 't-1' }] : []
    );
    const store = createCycleStore(db, boss);
    assert.equal(await store.claimCheck('r1', ID), null);
    assert.ok(
      queries.some((q) => q.sql.includes('from "claims" as "c"') && q.parameters.includes('t-1'))
    );
    assert.equal(await store.claimCheck('r1', 'bad'), null);
  });

  it('applies a claim patch with an edit event once per step and signals the claim', async () => {
    jobs.length = 0;
    const { db, queries } = createRecordingDb((q) =>
      ownedClaim(q)
        ? [owned]
        : q.sql.startsWith('insert into "claim_events"')
          ? [{ id: 'e1' }]
          : q.sql.startsWith('select "id", state')
            ? [{ id: CYCLE, wait_id: 'w1' }]
            : []
    );
    const patch: ClaimPatch = {
      serviceDate: '2026-10-02',
      documentation: null,
      tripType: null,
      level: null,
      emergency: null,
      loadedMiles: null,
      deceased: null,
      nonCoveredMiles: null,
      diagnoses: null,
      pickup: null,
      destination: null,
      originDestination: null,
      patientAddress: null,
      coverage: {
        coverageId: 'cov-1',
        payerId: null,
        memberId: 'M9',
        relationship: null,
        insuredFirstName: null,
        insuredLastName: null,
        remove: false
      },
      newCoverage: null,
      lines: null,
      note: 'Fixed the date'
    };
    await createCycleStore(db, boss).patchClaim('r1', ID, 'r1:s:patch:0', patch);
    const [edited] = sqlOf(queries, 'insert into "claim_events"');
    assert.ok(
      edited?.parameters.includes('edited') && edited.parameters.includes('Fixed the date')
    );
    assert.ok(edited?.parameters.includes('r1:s:patch:0'));
    assert.ok(queries.some((q) => q.sql.startsWith('update "claims" set "service_date"')));
    assert.ok(
      queries.some(
        (q) => q.sql.includes('update claim_coverages cc') && q.parameters.includes('M9')
      )
    );
    const [signal] = sqlOf(queries, 'insert into "signals"');
    assert.ok(signal?.parameters.includes(`claim:${ID}`));
    assert.deepEqual(
      jobs.map((j) => [j.runId, j.command.type]),
      [[CYCLE, 'resume']]
    );
    jobs.length = 0;
    const replay = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createCycleStore(replay.db, boss).patchClaim('r1', ID, 'r1:s:patch:0', patch);
    assert.equal(sqlOf(replay.queries, 'insert into "signals"').length, 0);
    assert.equal(sqlOf(replay.queries, 'update').length, 0);
    assert.deepEqual(jobs, []);
  });

  it('links a claim to a cycle run of the same agency only', async () => {
    const attach = (free: boolean) =>
      createRecordingDb((q) =>
        ownedClaim(q)
          ? [owned]
          : q.sql.startsWith('select "id" from "workflow_runs"')
            ? [{ id: CYCLE }]
            : q.sql.startsWith('update "claims"') && free
              ? [{}]
              : []
      );
    const { db, queries } = attach(true);
    await createCycleStore(db, boss).attachCycle('r1', ID, 'k', CYCLE);
    const run = queries.find((q) => q.sql.startsWith('select "id" from "workflow_runs"'));
    assert.ok(run?.parameters.includes('t-1'));
    const [update] = sqlOf(queries, 'update "claims"');
    assert.deepEqual(update?.parameters.slice(0, 3), [CYCLE, 'draft', 'needs_review']);
    assert.ok(update?.sql.includes('"status" = case when c.status = $2 then $3 else c.status end'));
    assert.ok(update?.sql.includes('"c"."cycle_run_id" is null'));
    assert.ok(update?.sql.includes('not exists (select "r"."id" from "workflow_runs" as "r"'));
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.deepEqual(link?.parameters.slice(0, 2), [ID, CYCLE]);
    const [signal] = sqlOf(queries, 'insert into "signals"');
    assert.ok(signal?.parameters.includes(`claim:${ID}`));
    const busy = attach(false);
    await assert.rejects(
      () => createCycleStore(busy.db, boss).attachCycle('r1', ID, 'k', CYCLE),
      /already has an active payer cycle/
    );
    assert.equal(sqlOf(busy.queries, 'insert into "claim_runs"').length, 0);
    assert.equal(sqlOf(busy.queries, 'insert into "signals"').length, 0);
    const missing = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    const store = createCycleStore(missing.db, boss);
    await assert.rejects(() => store.attachCycle('r1', ID, 'k', CYCLE), /does not exist/);
    await assert.rejects(() => store.attachCycle('r1', ID, 'k', 'cycle-1'), /does not exist/);
    assert.equal(sqlOf(missing.queries, 'update').length, 0);
  });

  it('closes under a row lock, as paid when nothing is owed, and only open claims', async () => {
    const close = async (
      locked: { status: string; balance_cents: number },
      requested: 'written_off' | 'void' = 'written_off'
    ) => {
      const { db, queries } = createRecordingDb((q) =>
        q.sql.includes('for update')
          ? [{ status: locked.status }]
          : q.sql.includes('from "claim_balances"')
            ? [{ balance_cents: locked.balance_cents }]
            : ownedClaim(q)
              ? [owned]
              : []
      );
      await createCycleStore(db, boss).closeClaim('r1', ID, 'k2', requested);
      return queries;
    };
    const owed = await close({ status: 'balance_review', balance_cents: 500 });
    const lockAt = owed.findIndex((q) => q.sql.endsWith('for update'));
    const balanceAt = owed.findIndex((q) => q.sql.includes('from "claim_balances"'));
    assert.ok(lockAt >= 0 && balanceAt > lockAt);
    assert.deepEqual(owed.find((q) => q.sql.startsWith('update'))?.parameters[0], 'written_off');
    const settled = await close({ status: 'balance_review', balance_cents: 0 });
    assert.deepEqual(settled.find((q) => q.sql.startsWith('update'))?.parameters[0], 'paid');
    const voided = await close({ status: 'draft', balance_cents: 0 }, 'void');
    assert.deepEqual(voided.find((q) => q.sql.startsWith('update'))?.parameters[0], 'void');
    const forgotten = owed.find((q) => q.sql.startsWith('delete from "signals"'));
    assert.ok(forgotten?.parameters.includes(`claim:${ID}`));
    const done = await close({ status: 'paid', balance_cents: 0 });
    assert.equal(
      done.some((q) => q.sql.startsWith('update')),
      false
    );
  });

  it('cancels the claim cycle and open claim tasks, never the closing run or its parents', async () => {
    jobs.length = 0;
    const { db, queries } = createRecordingDb((q) =>
      q.sql.includes('for update')
        ? [{ status: 'needs_review' }]
        : q.sql.includes('from "claim_balances"')
          ? [{ balance_cents: 500 }]
          : q.sql.includes('with recursive closing')
            ? [{ id: CYCLE }, { id: 'chase-1' }]
            : ownedClaim(q)
              ? [owned]
              : []
    );
    await createCycleStore(db, boss).closeClaim('r1', ID, 'k2', 'void');
    const others = queries.find((q) => q.sql.includes('with recursive closing'));
    assert.ok(others?.sql.includes('r.id not in (select id from closing)'));
    assert.deepEqual(others?.parameters.slice(0, 1), ['r1']);
    assert.deepEqual(
      jobs.map((j) => [j.runId, j.command.type]),
      [
        [CYCLE, 'cancel'],
        ['chase-1', 'cancel']
      ]
    );
    jobs.length = 0;
  });

  it('links a run to a claim of its own agency', async () => {
    const { db, queries } = createRecordingDb((q) => (ownedClaim(q) ? [owned] : []));
    await createCycleStore(db, boss).linkRun('r1', ID);
    const [link] = sqlOf(queries, 'insert into "claim_runs"');
    assert.deepEqual(link?.parameters.slice(0, 2), [ID, 'r1']);
    await assert.rejects(
      () => createCycleStore(createRecordingDb().db, boss).linkRun('r1', ID),
      /does not exist/
    );
  });
});
