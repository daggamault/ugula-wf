import { CLAIM_LEDGER_EVENTS, ledgerPayloadColumns } from '@ugula/billing';
import { type Database, EVENTS_CHANNEL } from '@ugula/db';
import { EVENT_TYPE_PATTERN } from '@ugula/graph';
import { type Kysely, sql } from 'kysely';

export const EVENT_FUNCTIONS = [
  'notify_workflow_events',
  'emit_claim_ledger_event',
  'emit_claim_change_events',
  'emit_task_completed_event'
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
    .where('created_by_id', 'is not', null),
  db.schema
    .createIndex('idx_events_agency_created')
    .on('events')
    .columns(['agency_id', 'created_at desc'])
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

const ledgerPayload = (type: string) =>
  sql.join(
    Object.entries(ledgerPayloadColumns(type)).map(
      ([field, column]) => sql`${sql.lit(field)}, new.${sql.id(column)}`
    )
  );

const ledgerEvents = sql.join(
  Object.entries(CLAIM_LEDGER_EVENTS).map(
    ([kind, type]) =>
      sql`when ${sql.lit(kind)} then
        insert into events (agency_id, type, payload)
        values (new.agency_id, ${sql.lit(type)}, jsonb_strip_nulls(jsonb_build_object(${ledgerPayload(type)})));`
  ),
  sql` `
);

const ledgerFunction = sql`
  create function emit_claim_ledger_event() returns trigger language plpgsql as $$
  begin
    case new.kind
      ${ledgerEvents}
      else null;
    end case;
    return null;
  end;
  $$`;

const ledgerTrigger = sql`
  create trigger claim_events_emit
  after insert on claim_events
  for each row execute function emit_claim_ledger_event()`;

const claimFunction = sql`
  create function emit_claim_change_events() returns trigger language plpgsql as $$
  begin
    if new.classification is not null and new.classification is distinct from old.classification then
      insert into events (agency_id, type, payload)
      values (new.agency_id, 'claim.classified',
        jsonb_build_object('claimId', new.id, 'classification', new.classification));
    end if;
    if new.status is distinct from old.status then
      insert into events (agency_id, type, payload)
      values (new.agency_id, 'claim.status_changed',
        jsonb_build_object('claimId', new.id, 'from', old.status, 'to', new.status));
      if new.status = 'paid' then
        insert into events (agency_id, type, payload)
        values (new.agency_id, 'claim.paid', jsonb_build_object('claimId', new.id));
      end if;
    end if;
    return null;
  end;
  $$`;

const claimTrigger = sql`
  create trigger claims_emit
  after update of status, classification on claims
  for each row execute function emit_claim_change_events()`;

const taskFunction = sql`
  create function emit_task_completed_event() returns trigger language plpgsql as $$
  begin
    insert into events (agency_id, type, payload)
    values (new.agency_id, 'task.completed', jsonb_strip_nulls(jsonb_build_object(
      'taskId', new.id,
      'claimId', (select cr.claim_id from claim_runs cr where cr.run_id = new.run_id limit 1),
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

export const createEventEmitters = async (db: Kysely<Database>) => {
  for (const statement of [
    ledgerFunction,
    ledgerTrigger,
    claimFunction,
    claimTrigger,
    taskFunction,
    taskTrigger
  ]) {
    await statement.execute(db);
  }
};
