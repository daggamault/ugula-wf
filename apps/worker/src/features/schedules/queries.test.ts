import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRecordingDb } from '@ugula/db/testing';
import { claimScheduleRun, findDueOn } from './queries.ts';

describe('findDueOn', () => {
  it("names the period's day once its hour has come in the agency's time zone", async () => {
    const { db, queries } = createRecordingDb(() => [{ fire_on: '2026-11-02' }]);
    assert.equal(
      await findDueOn(db, 'a1', 'billing.watch', { every: 'week', hour: 6 }),
      '2026-11-02'
    );
    assert.deepEqual(queries[0]?.parameters.slice(0, 1), ['week']);
    assert.match(queries[0]?.sql ?? '', /not exists \(\s+select 1 from schedule_runs r/);
  });

  it('gives nothing before the hour or once the period has run', async () => {
    const { db } = createRecordingDb(() => []);
    assert.equal(await findDueOn(db, 'a1', 'billing.watch', { every: 'day', hour: 6 }), null);
  });
});

describe('claimScheduleRun', () => {
  it('claims a period once, so a retried job never starts it twice', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.equal(await claimScheduleRun(db, 'a1', 'billing.watch', '2026-11-02'), undefined);
    assert.equal(
      queries[0]?.sql,
      'insert into "schedule_runs" ("agency_id", "workflow", "fire_on") values ($1, $2, $3) on conflict do nothing returning "agency_id"'
    );
  });
});
