import type { Api } from './api.ts';
import type { Intent } from './ui/intent.ts';

export type Notification = {
  id: string;
  intent: Intent;
  title: string;
  description: string | null;
  action: { label: string; to: string } | null;
  at: string;
  read: boolean;
};

type NotificationInput = {
  intent?: Intent | undefined;
  title: string;
  description?: string | undefined;
  action?: { label: string; to: string } | undefined;
};

export const createNotificationsClient = (api: Api) => ({
  list: () => api.get<{ items: Notification[]; unread: number }>('/api/notifications'),
  record: ({ intent = 'success', title, description, action }: NotificationInput) =>
    api.post('/api/notifications', {
      intent,
      title,
      description: description ?? null,
      link: action ?? null
    }),
  read: () => api.post('/api/notifications/read'),
  clear: () => api.post('/api/notifications/clear')
});

export type NotificationsClient = ReturnType<typeof createNotificationsClient>;
