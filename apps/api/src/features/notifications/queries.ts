import type { Database, NotificationIntent } from '@ugula/db';
import { type Kysely, sql } from 'kysely';

type Db = Kysely<Database>;

const NOTIFICATION_LIMIT = 50;

type NewNotification = {
  intent: NotificationIntent;
  title: string;
  description: string | null;
  link: { label: string; to: string } | null;
};

export const listNotifications = (db: Db, tenantId: string, userId: string) =>
  db
    .selectFrom('notifications as n')
    .leftJoin('notification_states as s', (j) => j.on('s.user_id', '=', userId))
    .select([
      'n.id',
      'n.intent',
      'n.title',
      'n.description',
      'n.link_label',
      'n.link_to',
      'n.created_at',
      sql<boolean>`s.read_at is not null and n.created_at <= s.read_at`.as('read')
    ])
    .where('n.tenant_id', '=', tenantId)
    .where((eb) => eb.or([eb('n.user_id', 'is', null), eb('n.user_id', '=', userId)]))
    .where(sql<boolean>`s.cleared_at is null or n.created_at > s.cleared_at`)
    .orderBy('n.created_at', 'desc')
    .orderBy('n.id', 'desc')
    .limit(NOTIFICATION_LIMIT)
    .execute();

export const insertNotification = (db: Db, tenantId: string, userId: string, n: NewNotification) =>
  db
    .insertInto('notifications')
    .values({
      tenant_id: tenantId,
      user_id: userId,
      intent: n.intent,
      title: n.title,
      description: n.description,
      link_label: n.link?.label ?? null,
      link_to: n.link?.to ?? null
    })
    .returning('id')
    .executeTakeFirstOrThrow();

export const markState = (db: Db, userId: string, clear: boolean) =>
  db
    .insertInto('notification_states')
    .values({
      user_id: userId,
      read_at: sql`now()`,
      cleared_at: clear ? sql`now()` : null
    })
    .onConflict((oc) =>
      oc.column('user_id').doUpdateSet({
        read_at: sql`now()`,
        ...(clear ? { cleared_at: sql`now()` } : {})
      })
    )
    .execute();
