import { BILLING_EVENTS } from '@ugula/billing';
import { type Database, EVENTS_CHANNEL } from '@ugula/db';
import { EVENT_TYPE_PATTERN } from '@ugula/graph';
import { NEMSIS_EVENTS } from '@ugula/nemsis';
import { type Kysely, sql } from 'kysely';

export const EVENT_FUNCTIONS = [
  'notify_workflow_events',
  'emit_task_completed_event',
  'emit_encounter_created_event',
  'emit_encounter_revised_event',
  'emit_claim_created_event'
] as const;

const buildEventsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('events')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('type', 'text', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('created_by_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null').onUpdate('cascade')
    )
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('dispatched_at', 'timestamptz')
    .addUniqueConstraint('events_agency_id_id_unique', ['agency_id', 'id'])
    .addCheckConstraint('events_type_check', sql`type ~ ${sql.lit(EVENT_TYPE_PATTERN.source)}`)
    .addCheckConstraint('events_payload_check', sql`jsonb_typeof(payload) = 'object'`);

const buildEventsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_events_pending')
    .on('events')
    .column('created_at')
    .where(sql.ref('dispatched_at'), 'is', null),
  db.schema
    .createIndex('idx_events_created_by_id')
    .on('events')
    .column('created_by_id')
    .where('created_by_id', 'is not', null)
];

const buildEventRunsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('event_runs')
    .addColumn('event_id', 'uuid', (col) => col.notNull())
    .addColumn('agency_id', 'uuid', (col) => col.notNull())
    .addColumn('workflow', 'text', (col) => col.notNull())
    .addColumn('run_id', 'uuid', (col) => col.notNull().unique())
    .addPrimaryKeyConstraint('event_runs_pkey', ['event_id', 'workflow'])
    .addForeignKeyConstraint(
      'event_runs_event_id_fkey',
      ['agency_id', 'event_id'],
      'events',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    )
    .addForeignKeyConstraint(
      'event_runs_run_id_fkey',
      ['agency_id', 'run_id'],
      'workflow_runs',
      ['agency_id', 'id'],
      (fk) => fk.onDelete('cascade').onUpdate('cascade')
    );

const notifyFunction = sql`
  create function notify_workflow_events() returns trigger language plpgsql as $$
  begin
    perform pg_notify(${sql.lit(EVENTS_CHANNEL)}, '');
    return null;
  end;
  $$`;

const notifyTrigger = sql`
  create trigger events_notify
  after insert on events
  for each statement execute function notify_workflow_events()`;

export const createEventsTables = async (db: Kysely<Database>) => {
  await buildEventsTable(db).execute();
  for (const index of buildEventsIndexes(db)) await index.execute();
  await buildEventRunsTable(db).execute();
  await notifyFunction.execute(db);
  await notifyTrigger.execute(db);
};

const taskFunction = sql`
  create function emit_task_completed_event() returns trigger language plpgsql as $$
  begin
    insert into events (agency_id, type, payload)
    values (new.agency_id, ${sql.lit(BILLING_EVENTS.taskCompleted)}, jsonb_strip_nulls(jsonb_build_object(
      'taskId', new.id,
      'queue', new.queue,
      'outcome', new.resolution ->> 'outcome'
    )));
    return null;
  end;
  $$`;

const taskTrigger = sql`
  create trigger tasks_emit_completed
  after update of status on tasks
  for each row when (new.status = 'completed' and old.status is distinct from 'completed')
  execute function emit_task_completed_event()`;

const encounterCreatedFunction = sql`
  create function emit_encounter_created_event() returns trigger language plpgsql as $$
  begin
    insert into events (agency_id, type, payload)
    values (new.agency_id, ${sql.lit(NEMSIS_EVENTS.encounterCreated)}, jsonb_build_object(
      'encounterId', new.id,
      'pcrNumber', new.pcr_number
    ));
    return null;
  end;
  $$`;

const encounterCreatedTrigger = sql`
  create trigger encounters_emit_created
  after insert on encounters
  for each row execute function emit_encounter_created_event()`;

const encounterRevisedFunction = sql`
  create function emit_encounter_revised_event() returns trigger language plpgsql as $$
  begin
    insert into events (agency_id, type, payload)
    values (new.agency_id, ${sql.lit(NEMSIS_EVENTS.encounterRevised)}, jsonb_build_object(
      'encounterId', new.id,
      'pcrNumber', new.pcr_number,
      'revision', new.revision
    ));
    return null;
  end;
  $$`;

const encounterRevisedTrigger = sql`
  create trigger encounters_emit_revised
  after update of revision on encounters
  for each row when (new.revision > old.revision)
  execute function emit_encounter_revised_event()`;

const claimCreatedFunction = sql`
  create function emit_claim_created_event() returns trigger language plpgsql as $$
  begin
    insert into events (agency_id, type, payload)
    values (new.agency_id, ${sql.lit(BILLING_EVENTS.claimCreated)}, jsonb_build_object(
      'claimId', new.id,
      'encounterId', new.encounter_id
    ));
    return null;
  end;
  $$`;

const claimCreatedTrigger = sql`
  create trigger claims_emit_created
  after insert on claims
  for each row execute function emit_claim_created_event()`;

export const createEventEmitters = async (db: Kysely<Database>) => {
  for (const statement of [
    taskFunction,
    taskTrigger,
    encounterCreatedFunction,
    encounterCreatedTrigger,
    encounterRevisedFunction,
    encounterRevisedTrigger,
    claimCreatedFunction,
    claimCreatedTrigger
  ]) {
    await statement.execute(db);
  }
};
