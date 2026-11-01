import { BellIcon, Trash2Icon } from 'lucide-react';
import { type ToggleEvent, useId, useRef } from 'react';
import { classNamesOf } from '../class-names.ts';
import { formatAgo, formatDateTime } from '../format.ts';
import { Link } from '../router.tsx';
import { intentIcons } from './alert.tsx';
import { Button } from './button.tsx';
import { EmptyText } from './empty-state.tsx';
import { IconButton } from './icon-button.tsx';
import { interactiveClasses } from './interactive.ts';
import { hidePopover } from './popover.ts';
import { accentClasses, type Notification, useNotifications } from './toast.tsx';

export const unreadCount = (items: readonly Notification[]) => items.filter((n) => !n.read).length;

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
        const intent = n.intent ?? 'success';
        const Icon = intentIcons[intent];
        return (
          <li
            key={n.id}
            className={classNamesOf('flex gap-3 px-4 py-3', n.read ? '' : 'bg-primary/5')}
          >
            <Icon
              aria-hidden="true"
              className={classNamesOf('mt-0.5 size-4.5 shrink-0', accentClasses[intent])}
            />
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
                  <Link
                    to={n.action.to}
                    onClick={onFollow}
                    className={classNamesOf(
                      interactiveClasses,
                      'text-primary rounded font-semibold hover:underline'
                    )}
                  >
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
      <EmptyText>Nothing yet. Messages that pop up while you work are kept here.</EmptyText>
    </div>
  );

export const NotificationsButton = () => {
  const { items, markAllRead, clear } = useNotifications();
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = `notifications-${useId().replace(/[^\w-]/g, '')}`;
  const anchorName = `--${panelId}`;
  const unread = unreadCount(items);
  const close = () => hidePopover(panelRef.current);
  const onToggle = (e: ToggleEvent) => {
    if (e.newState === 'closed') markAllRead();
  };
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
          className="bg-primary text-primary-fg pointer-events-none absolute -top-0.5 -right-0.5 min-w-4 rounded-full px-1 text-center text-[0.625rem]/4 font-bold tabular-nums"
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
        className="bg-surface text-surface-fg border-border inset-auto m-2 max-h-[min(32rem,80vh)] w-96 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-xl border p-0 shadow-xl [position-area:bottom_span-right] [position-try-fallbacks:flip-inline]"
      >
        <div className="border-border bg-surface sticky top-0 flex items-center justify-between gap-2 border-b px-4 py-2">
          <h2 className="text-sm font-bold">Notifications</h2>
          <Button
            variant="outline"
            size="sm"
            disabledReason={items.length ? undefined : 'Nothing to clear.'}
            onClick={clear}
          >
            <Trash2Icon aria-hidden="true" className="size-4" />
            Clear all
          </Button>
        </div>
        <NotificationList items={items} onFollow={close} />
      </div>
    </span>
  );
};
