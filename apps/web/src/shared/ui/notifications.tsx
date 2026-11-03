import { BellIcon, Trash2Icon } from 'lucide-react';
import { type ToggleEvent, useId, useRef } from 'react';
import { classNamesOf } from '../class-names.ts';
import { formatAgo, formatDateTime } from '../format.ts';
import { type Live, useLive } from '../live.ts';
import type { Notification, NotificationsClient } from '../notifications.ts';
import { Link } from '../router.tsx';
import { useResource } from '../use-resource.ts';
import { intentIcons } from './alert.tsx';
import { Button } from './button.tsx';
import { EmptyText } from './empty-state.tsx';
import { IconButton } from './icon-button.tsx';
import { hidePopover } from './popover.ts';
import { textLinkClasses } from './text-link.tsx';
import { accentClasses } from './toast.tsx';

export const NotificationList = ({
  items,
  onFollow
}: {
  items: readonly Notification[];
  onFollow?: () => void;
}) =>
  items.length ? (
    <ol className="divide-border flex flex-col divide-y">
      {items.map((n) => {
        const Icon = intentIcons[n.intent];
        return (
          <li
            key={n.id}
            className={classNamesOf('flex gap-3 px-4 py-3', n.read ? '' : 'bg-primary/5')}
          >
            <span className="flex h-5 shrink-0 items-center">
              <Icon
                aria-hidden="true"
                className={classNamesOf('size-4', accentClasses[n.intent])}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <p className="text-sm font-semibold">
                {n.read ? null : <span className="sr-only">New: </span>}
                {n.title}
              </p>
              {n.description ? (
                <p className="text-surface-fg-muted text-sm">{n.description}</p>
              ) : null}
              <p className="text-surface-fg-muted flex flex-wrap items-center gap-3 text-xs">
                <time dateTime={n.at} title={formatDateTime(n.at)}>
                  {formatAgo(n.at)}
                </time>
                {n.action ? (
                  <Link to={n.action.to} onClick={onFollow} className={textLinkClasses}>
                    {n.action.label}
                  </Link>
                ) : null}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  ) : (
    <div className="p-4">
      <EmptyText>
        Nothing yet. New tasks, stuck runs and messages from your work are kept here.
      </EmptyText>
    </div>
  );

export const NotificationsPanel = ({
  items,
  unread,
  onOpenChange,
  onClear
}: {
  items: readonly Notification[];
  unread: number;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
}) => {
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `notifications-${useId().replace(/[^\w-]/g, '')}`;
  const anchorName = `--${panelId}`;
  const onToggle = (e: ToggleEvent) => onOpenChange(e.newState === 'open');
  return (
    <span className="relative inline-flex" style={{ anchorName }}>
      <IconButton
        label={unread ? `Notifications (${unread} new)` : 'Notifications'}
        icon={BellIcon}
        popoverTarget={panelId}
      />
      {unread ? (
        <span
          aria-hidden="true"
          className="bg-primary text-primary-fg pointer-events-none absolute -top-1 -right-1 min-w-5 rounded-full px-1.5 text-center text-xs/5 font-bold tabular-nums"
        >
          {unread > 9 ? '9+' : unread}
        </span>
      ) : null}
      <div
        ref={panelRef}
        id={panelId}
        popover="auto"
        role="dialog"
        aria-label="Notifications"
        onToggle={onToggle}
        style={{ positionAnchor: anchorName }}
        className="bg-surface text-surface-fg border-border inset-auto m-2 max-h-[min(32rem,80vh)] w-96 max-w-[calc(100vw-1rem)] scale-95 overflow-y-auto rounded-xl border p-0 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out [position-area:bottom_span-right] [position-try-fallbacks:flip-inline] open:scale-100 open:opacity-100 starting:open:scale-95 starting:open:opacity-0"
      >
        <div className="border-border bg-surface sticky top-0 flex items-center justify-between gap-2 border-b px-4 py-3">
          <h2 className="text-base font-bold">Notifications</h2>
          <Button
            variant="outline"
            size="sm"
            disabledReason={items.length ? undefined : 'Nothing to clear.'}
            onClick={onClear}
          >
            <Trash2Icon aria-hidden="true" className="size-4" />
            Clear All
          </Button>
        </div>
        <NotificationList items={items} onFollow={() => hidePopover(panelRef.current)} />
      </div>
    </span>
  );
};

export const NotificationsButton = ({
  client,
  live
}: {
  client: NotificationsClient;
  live: Live;
}) => {
  const feed = useResource('notifications', client.list, 60_000);
  useLive(live, (e) => e.kind === 'notification' || e.kind === 'task', feed.reload);
  const items = feed.data?.items ?? [];
  const unread = feed.data?.unread ?? 0;
  const done = (work: Promise<unknown>) => void work.then(feed.reload, () => undefined);
  return (
    <NotificationsPanel
      items={items}
      unread={unread}
      onOpenChange={(open) => {
        if (!open && unread) done(client.read());
      }}
      onClear={() => done(client.clear())}
    />
  );
};
