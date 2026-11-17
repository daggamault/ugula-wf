import {
  type Signature,
  type Trigger,
  triggerInputs,
  triggerMatches,
  triggerSchema,
  type Values
} from '@ugula/graph';
import type { RunQueueClient } from '@ugula/run-queue';
import { type Kysely, sql } from 'kysely';
import * as v from 'valibot';
import { resolvedGraph } from './graph-versions.ts';
import { startRun } from './runs.ts';
import type { Database } from './schema.ts';

type Db = Kysely<Database>;

export const EVENTS_CHANNEL = 'workflow_events';

type NewEvent = {
  agencyId: string;
  type: string;
  payload: Values;
  createdBy?: string | null;
};

export const emitEvent = async (db: Db, event: NewEvent) => {
  const { id } = await db
    .insertInto('events')
    .values({
      agency_id: event.agencyId,
      type: event.type,
      payload: JSON.stringify(event.payload),
      created_by_id: event.createdBy ?? null
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return id;
};

export type TriggeredWorkflow = {
  key: string;
  versionId: string;
  trigger: Trigger;
  signature: Signature;
};

type TriggeredRow = { key: string; version_id: string; trigger: unknown; signature: Signature };

type TriggerKind = Exclude<Trigger['kind'], 'manual'>;

const triggerIs = (alias: string, kind: TriggerKind, event: string | null) => {
  const t = sql.ref(`${alias}.trigger`);
  return event === null
    ? sql<boolean>`${t} ->> 'kind' = ${kind}`
    : sql<boolean>`${t} ->> 'kind' = ${kind} and ${t} ->> 'event' = ${event}`;
};

const findTriggered = async (
  db: Db,
  agencyId: string,
  kind: TriggerKind,
  event: string | null
): Promise<TriggeredWorkflow[]> => {
  const { rows } = await sql<TriggeredRow>`
    select c.key, v.id as version_id, v.trigger, v.definition -> 'signature' as signature
    from (
      select distinct g.key
      from graphs g
      join graph_versions gv on gv.graph_id = g.id
      where g.kind = 'workflow' and g.is_active and gv.published_at is not null
        and (g.agency_id is null or g.agency_id = ${agencyId}::uuid)
        and ${triggerIs('gv', kind, event)}
    ) c
    join graph_versions v on v.id = ${resolvedGraph(agencyId, sql.ref('c.key'))}
    where ${triggerIs('v', kind, event)}
    order by c.key`.execute(db);
  return rows.flatMap((r) => {
    const trigger = v.safeParse(triggerSchema, r.trigger);
    return trigger.success
      ? [{ key: r.key, versionId: r.version_id, trigger: trigger.output, signature: r.signature }]
      : [];
  });
};

export const findEventWorkflows = (db: Db, agencyId: string, type: string) =>
  findTriggered(db, agencyId, 'event', type);

export const findScheduledWorkflows = (db: Db, agencyId: string) =>
  findTriggered(db, agencyId, 'schedule', null);

type PendingEvent = {
  id: string;
  agency_id: string;
  type: string;
  payload: Values;
  created_by_id: string | null;
};

const claimPendingEvents = (db: Db, limit: number) =>
  db
    .selectFrom('events')
    .select(['id', 'agency_id', 'type', 'payload', 'created_by_id'])
    .where('dispatched_at', 'is', null)
    .orderBy('created_at')
    .orderBy('id')
    .limit(limit)
    .forUpdate()
    .skipLocked()
    .execute() as Promise<PendingEvent[]>;

const startEventRun = async (
  tx: Db,
  boss: RunQueueClient,
  event: PendingEvent,
  workflow: TriggeredWorkflow
) => {
  const runId = await startRun(tx, boss, {
    agencyId: event.agency_id,
    versionId: workflow.versionId,
    inputs: triggerInputs(workflow.signature, event.payload),
    ...(event.created_by_id ? { interactive: true, startedBy: event.created_by_id } : {})
  });
  await tx
    .insertInto('event_runs')
    .values({
      event_id: event.id,
      agency_id: event.agency_id,
      workflow: workflow.key,
      run_id: runId
    })
    .execute();
  return runId;
};

type WorkflowsFor = (event: PendingEvent) => Promise<TriggeredWorkflow[]>;

const deliver = async (
  tx: Db,
  boss: RunQueueClient,
  events: PendingEvent[],
  workflowsFor: WorkflowsFor
) => {
  const runIds: string[] = [];
  for (const event of events) {
    for (const workflow of await workflowsFor(event)) {
      if (!triggerMatches(workflow.trigger, { type: event.type, payload: event.payload })) continue;
      runIds.push(await startEventRun(tx, boss, event, workflow));
    }
  }
  if (events.length) {
    await tx
      .updateTable('events')
      .set({ dispatched_at: sql`now()` })
      .where(
        'id',
        'in',
        events.map((e) => e.id)
      )
      .execute();
  }
  return runIds;
};

const cachedWorkflows = (tx: Db): WorkflowsFor => {
  const cache = new Map<string, Promise<TriggeredWorkflow[]>>();
  return (e) => {
    const key = `${e.agency_id}:${e.type}`;
    const hit = cache.get(key) ?? findEventWorkflows(tx, e.agency_id, e.type);
    cache.set(key, hit);
    return hit;
  };
};

export const dispatchEvents = async (db: Db, boss: RunQueueClient, limit: number) =>
  db.transaction().execute(async (tx) => {
    const events = await claimPendingEvents(tx, limit);
    const runIds = await deliver(tx, boss, events, cachedWorkflows(tx));
    return { events: events.length, started: runIds.length };
  });

export const emitAndDispatch = async (tx: Db, boss: RunQueueClient, event: NewEvent) => {
  const id = await emitEvent(tx, event);
  const pending: PendingEvent = {
    id,
    agency_id: event.agencyId,
    type: event.type,
    payload: event.payload,
    created_by_id: event.createdBy ?? null
  };
  return { eventId: id, runIds: await deliver(tx, boss, [pending], cachedWorkflows(tx)) };
};
