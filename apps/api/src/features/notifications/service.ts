import type { Db } from '@ugula/db';
import { type Announce, announced } from '../../shared/live.ts';
import { ok } from '../../shared/result.ts';
import { insertNotification, listNotifications, markState } from './queries.ts';
import type { NotificationInput } from './schemas.ts';

type Row = Awaited<ReturnType<typeof listNotifications>>[number];

export const toNotification = (r: Row) => ({
  id: r.id,
  intent: r.intent,
  title: r.title,
  description: r.description,
  action: r.link_label && r.link_to ? { label: r.link_label, to: r.link_to } : null,
  at: new Date(r.created_at).toISOString(),
  read: r.read
});

export const createNotificationService = ({ db, announce }: { db: Db; announce: Announce }) => {
  const changed = (tenantId: string, work: Promise<unknown>) =>
    announced(
      announce,
      tenantId,
      work.then(() => ok({ status: 'ok' })),
      () => [{ kind: 'notification', id: null }]
    );

  return {
    list: async (tenantId: string, userId: string) => {
      const items = (await listNotifications(db, tenantId, userId)).map(toNotification);
      return ok({ items, unread: items.filter((n) => !n.read).length });
    },

    create: (tenantId: string, userId: string, input: NotificationInput) =>
      changed(
        tenantId,
        insertNotification(db, tenantId, userId, {
          intent: input.intent,
          title: input.title,
          description: input.description || null,
          link: input.link
        })
      ),

    read: (tenantId: string, userId: string) => changed(tenantId, markState(db, userId, false)),

    clear: (tenantId: string, userId: string) => changed(tenantId, markState(db, userId, true))
  };
};

export type NotificationService = ReturnType<typeof createNotificationService>;
