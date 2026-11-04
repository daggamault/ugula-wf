import { type Database, NOTIFICATION_INTENTS } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

const buildNotificationsTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('notifications')
    .addColumn('id', 'uuid', (col) => col.primaryKey().defaultTo(sql`uuidv7()`))
    .addColumn('agency_id', 'uuid', (col) =>
      col.notNull().references('agencies.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('intent', 'text', (col) => col.notNull().defaultTo('info'))
    .addColumn('title', 'text', (col) => col.notNull())
    .addColumn('description', 'text')
    .addColumn('link_label', 'text')
    .addColumn('link_to', 'text')
    .addColumn('created_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addCheckConstraint(
      'notifications_intent_check',
      sql`intent in (${sql.join(NOTIFICATION_INTENTS.map((v) => sql.lit(v)))})`
    )
    .addCheckConstraint(
      'notifications_link_check',
      sql`(link_label is null) = (link_to is null) and (link_to is null or link_to like '/%')`
    );

const buildNotificationStatesTable = (db: Kysely<Database>) =>
  db.schema
    .createTable('notification_states')
    .addColumn('user_id', 'uuid', (col) =>
      col.primaryKey().references('users.id').onDelete('cascade').onUpdate('cascade')
    )
    .addColumn('read_at', 'timestamptz', (col) => col.notNull().defaultTo(sql`now()`))
    .addColumn('cleared_at', 'timestamptz');

const buildNotificationsIndexes = (db: Kysely<Database>) => [
  db.schema
    .createIndex('idx_notifications_agency_created')
    .on('notifications')
    .columns(['agency_id', 'created_at desc']),
  db.schema.createIndex('idx_notifications_user_id').on('notifications').column('user_id')
];

export const createNotificationsTables = async (db: Kysely<Database>) => {
  await buildNotificationsTable(db).execute();
  await buildNotificationStatesTable(db).execute();
  for (const index of buildNotificationsIndexes(db)) await index.execute();
};
