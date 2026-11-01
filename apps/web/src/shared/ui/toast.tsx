import { XIcon } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { intentIcons } from './alert.tsx';
import { IconButton } from './icon-button.tsx';
import type { Intent } from './intent.ts';
import { interactiveClasses } from './interactive.ts';

export type ToastAction = { label: string; to: string };

export type ToastInput = {
  key?: string;
  intent?: Intent;
  title: string;
  description?: string;
  action?: ToastAction;
};

export type ToastItem = ToastInput & { id: number };

export const TOAST_LIMIT = 4;

export const TOAST_MS = 6_000;

const keyOf = (toast: ToastInput) => toast.key ?? toast.title;

export const addToast = (toasts: readonly ToastItem[], toast: ToastItem) =>
  [...toasts.filter((t) => keyOf(t) !== keyOf(toast)), toast].slice(-TOAST_LIMIT);

export type Notify = (toast: ToastInput) => void;

const ToastContext = createContext<Notify>(() => undefined);

export const useToast = () => useContext(ToastContext);

export type Notification = ToastInput & { id: string; at: string; read: boolean };

export const NOTIFICATION_LIMIT = 50;

export const recordNotification = (
  list: readonly Notification[],
  notification: Notification
): Notification[] =>
  [notification, ...list.filter((n) => keyOf(n) !== keyOf(notification))].slice(
    0,
    NOTIFICATION_LIMIT
  );

const isNotification = (x: unknown): x is Notification =>
  typeof x === 'object' &&
  x !== null &&
  typeof (x as Notification).id === 'string' &&
  typeof (x as Notification).title === 'string' &&
  typeof (x as Notification).at === 'string';

export const readNotifications = (raw: string | null): Notification[] => {
  try {
    const parsed: unknown = JSON.parse(raw ?? '[]');
    return Array.isArray(parsed) ? parsed.filter(isNotification).slice(0, NOTIFICATION_LIMIT) : [];
  } catch {
    return [];
  }
};

export type Notifications = {
  items: readonly Notification[];
  markAllRead: () => void;
  clear: () => void;
};

const NotificationsContext = createContext<Notifications>({
  items: [],
  markAllRead: () => undefined,
  clear: () => undefined
});

export const useNotifications = () => useContext(NotificationsContext);

const storageOf = () => (typeof localStorage === 'undefined' ? null : localStorage);

const useNotificationLog = (storageKey: string | undefined) => {
  const [items, setItems] = useState<Notification[]>(() =>
    storageKey ? readNotifications(storageOf()?.getItem(storageKey) ?? null) : []
  );
  useEffect(() => {
    if (storageKey) storageOf()?.setItem(storageKey, JSON.stringify(items));
  }, [storageKey, items]);
  const record = useCallback((toast: ToastInput) => {
    const notification = {
      ...toast,
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      read: false
    };
    setItems((list) => recordNotification(list, notification));
  }, []);
  const markAllRead = useCallback(
    () =>
      setItems((list) =>
        list.some((n) => !n.read) ? list.map((n) => ({ ...n, read: true })) : list
      ),
    []
  );
  const clear = useCallback(() => setItems([]), []);
  return { items, record, markAllRead, clear };
};

export const accentClasses: Readonly<Record<Intent, string>> = {
  primary: 'text-primary',
  success: 'text-success',
  info: 'text-info',
  warning: 'text-warning-fg',
  danger: 'text-danger'
};

const ToastCard = ({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) => {
  const [paused, setPaused] = useState(false);
  const intent = toast.intent ?? 'success';
  const Icon = intentIcons[intent];
  const dismiss = () => onDismiss(toast.id);

  useEffect(() => {
    if (paused) return;
    const timer = setTimeout(() => onDismiss(toast.id), TOAST_MS);
    return () => clearTimeout(timer);
  }, [paused, onDismiss, toast.id]);

  return (
    <li
      role={intent === 'danger' ? 'alert' : 'status'}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="border-border bg-surface animate-toast pointer-events-auto flex items-start gap-3 rounded-xl border p-3 pl-4 shadow-lg"
    >
      <Icon
        aria-hidden="true"
        className={classNamesOf('mt-0.5 size-5 shrink-0', accentClasses[intent])}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description ? (
          <p className="text-surface-fg-muted text-sm">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <Link
            to={toast.action.to}
            onClick={dismiss}
            className={classNamesOf(
              interactiveClasses,
              'text-primary w-fit rounded text-sm font-semibold hover:underline'
            )}
          >
            {toast.action.label}
          </Link>
        ) : null}
      </div>
      <IconButton label="Dismiss" icon={XIcon} tooltipSide="left" onClick={dismiss} />
    </li>
  );
};

export const Toaster = ({
  toasts,
  onDismiss
}: {
  toasts: readonly ToastItem[];
  onDismiss: (id: number) => void;
}) => (
  <section
    aria-label="Notifications"
    className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center p-4 sm:justify-end"
  >
    <ol className="flex w-full max-w-sm flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </ol>
  </section>
);

export const ToastProvider = ({
  storageKey,
  children
}: {
  storageKey?: string;
  children?: ReactNode;
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const { items, record, markAllRead, clear } = useNotificationLog(storageKey);
  const seq = useRef(0);
  const notify = useCallback<Notify>(
    (toast) => {
      seq.current += 1;
      const id = seq.current;
      setToasts((list) => addToast(list, { ...toast, id }));
      record(toast);
    },
    [record]
  );
  const notifications = useMemo(() => ({ items, markAllRead, clear }), [items, markAllRead, clear]);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    []
  );
  return (
    <ToastContext value={notify}>
      <NotificationsContext value={notifications}>
        {children}
        <Toaster toasts={toasts} onDismiss={dismiss} />
      </NotificationsContext>
    </ToastContext>
  );
};
