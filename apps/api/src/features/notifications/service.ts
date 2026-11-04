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
  const changed = (agencyId: string, work: Promise<unknown>) =>
    announced(
      announce,
      agencyId,
      work.then(() => ok({ status: 'ok' })),
      () => [{ kind: 'notification', id: null }]
    );

  return {
    list: async (agencyId: string, userId: string) => {
      const items = (await listNotifications(db, agencyId, userId)).map(toNotification);
      return ok({ items, unread: items.filter((n) => !n.read).length });
    },

    create: (agencyId: string, userId: string, input: NotificationInput) =>
      changed(
        agencyId,
        insertNotification(db, agencyId, userId, {
          intent: input.intent,
          title: input.title,
          description: input.description || null,
          link: input.link
        })
      ),

    read: (agencyId: string, userId: string) => changed(agencyId, markState(db, userId, false)),

    clear: (agencyId: string, userId: string) => changed(agencyId, markState(db, userId, true))
  };
};

export type NotificationService = ReturnType<typeof createNotificationService>;
