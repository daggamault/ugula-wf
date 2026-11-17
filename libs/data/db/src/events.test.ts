import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { RunQueueClient } from '@ugula/run-queue';
import type { CompiledQuery } from 'kysely';
import {
  dispatchEvents,
  emitAndDispatch,
  emitEvent,
  findEventWorkflows,
  findScheduledWorkflows
} from './events.ts';
import { createRecordingDb } from './testing.ts';

const SIGNATURE = {
  execIn: ['exec'],
  execOut: [],
  inputs: [
    { name: 'claimId', type: 'string' },
    { name: 'route', type: 'string', optional: true }
  ],
  outputs: []
};

const denied = (where = {}) => ({
  key: 'acme.on-denial',
  version_id: 'v1',
  trigger: { kind: 'event', event: 'claim.denied', where },
  signature: SIGNATURE
});

type Pending = {
  id: string;
  agency_id: string;
  type: string;
  payload: object;
  created_by_id: string | null;
};

const recording = (pending: Pending[], workflows: object[]) => {
  let runs = 0;
  return createRecordingDb((q: CompiledQuery) => {
    if (
      q.sql.startsWith('select "id", "agency_id", "type", "payload", "created_by_id" from "events"')
    ) {
      return pending;
    }
    if (q.sql.includes('v.id as version_id')) return workflows;
    if (q.sql.startsWith('insert into "events"')) return [{ id: 'e9' }];
    if (q.sql.startsWith('insert into "workflow_runs"')) return [{ id: `r${++runs}` }];
    return [];
  });
};

const boss = () => {
  const jobs: unknown[] = [];
  const client: RunQueueClient = { insert: async (_, batch) => void jobs.push(...batch) };
  return { client, jobs };
};

describe('emitEvent', () => {
  it('saves the event to the outbox for the dispatcher', async () => {
    const { db, queries } = createRecordingDb(() => [{ id: 'e1' }]);
    assert.equal(
      await emitEvent(db, {
        agencyId: 'a1',
        type: 'payer_file.received',
        payload: { fileName: 'x' }
      }),
      'e1'
    );
    assert.equal(
      queries[0]?.sql,
      'insert into "events" ("agency_id", "type", "payload", "created_by_id") values ($1, $2, $3, $4) returning "id"'
    );
    assert.deepEqual(queries[0]?.parameters, [
      'a1',
      'payer_file.received',
      '{"fileName":"x"}',
      null
    ]);
    await db.destroy();
  });
});

describe('findEventWorkflows', () => {
  it("finds the agency's effective published workflows whose trigger is the event", async () => {
    const { db, queries } = createRecordingDb(() => [
      denied(),
      { ...denied(), trigger: { kind: 'nope' } }
    ]);
    assert.deepEqual(await findEventWorkflows(db, 'a1', 'claim.denied'), [
      {
        key: 'acme.on-denial',
        versionId: 'v1',
        trigger: { kind: 'event', event: 'claim.denied', where: {} },
        signature: SIGNATURE
      }
    ]);
    const sql = queries[0]?.sql ?? '';
    assert.match(sql, /g\.kind = 'workflow' and g\.is_active and gv\.published_at is not null/);
    assert.match(sql, /"gv"\."trigger" ->> 'kind' = \$2 and "gv"\."trigger" ->> 'event' = \$3/);
    assert.match(sql, /join graph_versions v on v\.id = \(/);
    assert.match(
      sql,
      /where "v"\."trigger" ->> 'kind' = \$\d+ and "v"\."trigger" ->> 'event' = \$\d+/
    );
    assert.deepEqual(queries[0]?.parameters.slice(0, 3), ['a1', 'event', 'claim.denied']);
    await db.destroy();
  });

  it('finds scheduled workflows by their kind of trigger alone', async () => {
    const { db, queries } = createRecordingDb(() => []);
    assert.deepEqual(await findScheduledWorkflows(db, 'a1'), []);
    assert.ok(!(queries[0]?.sql ?? '').includes("->> 'event'"));
    assert.deepEqual(queries[0]?.parameters.slice(0, 2), ['a1', 'schedule']);
    await db.destroy();
  });
});

describe('dispatchEvents', () => {
  it('starts one run per matching workflow with the payload it takes, then marks the batch', async () => {
    const pending = [
      {
        id: 'e1',
        agency_id: 'a1',
        type: 'claim.denied',
        payload: { claimId: 'c1', route: 'appeal', note: 'x' },
        created_by_id: null
      },
      {
        id: 'e2',
        agency_id: 'a1',
        type: 'claim.denied',
        payload: { claimId: 'c2', route: 'fix' },
        created_by_id: null
      }
    ];
    const { db, queries } = recording(pending, [denied({ route: { op: 'is', value: 'appeal' } })]);
    const { client, jobs } = boss();
    assert.deepEqual(await dispatchEvents(db, client, 50), { events: 2, started: 1 });
    const claim = queries.find((q) => q.sql.startsWith('select "id", "agency_id"'));
    assert.match(
      claim?.sql ?? '',
      /where "dispatched_at" is null order by "created_at", "id" limit \$1 for update skip locked$/
    );
    assert.equal(queries.filter((q) => q.sql.includes('v.id as version_id')).length, 1);
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.deepEqual(run?.parameters, [
      'a1',
      'v1',
      'running',
      '{"claimId":"c1","route":"appeal"}',
      null
    ]);
    const linked = queries.find((q) => q.sql.startsWith('insert into "event_runs"'));
    assert.deepEqual(linked?.parameters, ['e1', 'a1', 'acme.on-denial', 'r1']);
    const marked = queries.find((q) => q.sql.startsWith('update "events"'));
    assert.deepEqual(marked?.parameters, ['e1', 'e2']);
    assert.equal(jobs.length, 1);
    await db.destroy();
  });

  it('marks nothing when no event is waiting', async () => {
    const { db, queries } = recording([], []);
    assert.deepEqual(await dispatchEvents(db, boss().client, 50), { events: 0, started: 0 });
    assert.ok(!queries.some((q) => q.sql.startsWith('update')));
    await db.destroy();
  });
});

describe('emitAndDispatch', () => {
  it('starts the runs an event triggers in the same transaction, as the person who caused it', async () => {
    const { db, queries } = recording([], [denied()]);
    const { client, jobs } = boss();
    assert.deepEqual(
      await emitAndDispatch(db, client, {
        agencyId: 'a1',
        type: 'claim.denied',
        payload: { claimId: 'c1' },
        createdBy: 'u1'
      }),
      { eventId: 'e9', runIds: ['r1'] }
    );
    const run = queries.find((q) => q.sql.startsWith('insert into "workflow_runs"'));
    assert.equal(run?.parameters[4], 'u1');
    assert.deepEqual(queries.find((q) => q.sql.startsWith('update "events"'))?.parameters, ['e9']);
    assert.deepEqual(jobs, [{ data: { runId: 'r1', command: { type: 'advance' } }, priority: 2 }]);
    await db.destroy();
  });
});
