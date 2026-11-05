import { XIcon } from 'lucide-react';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { intentIcons } from './alert.tsx';
import { IconButton } from './icon-button.tsx';
import type { Intent } from './intent.ts';
import { textLinkClasses } from './text-link.tsx';

type ToastAction = { label: string; to: string };

export type ToastInput = {
  key?: string;
  isRecorded?: boolean;
  intent?: Intent;
  title: string;
  description?: string;
  action?: ToastAction;
};

type ToastItem = ToastInput & { id: number };

export const TOAST_LIMIT = 4;

const TOAST_MS = 6_000;

const keyOf = (toast: ToastInput) => toast.key ?? toast.title;

export const addToast = (toasts: readonly ToastItem[], toast: ToastItem) => {
  const shown = toasts.find((t) => keyOf(t) === keyOf(toast));
  return shown
    ? toasts.map((t) => (t === shown ? { ...toast, id: shown.id } : t))
    : [...toasts, toast].slice(-TOAST_LIMIT);
};

export type Notify = (toast: ToastInput) => void;

const ToastContext = createContext<Notify>(() => undefined);

export const useToast = () => useContext(ToastContext);

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
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="border-border bg-surface animate-toast pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg"
    >
      <span className="flex h-5 shrink-0 items-center">
        <Icon aria-hidden="true" className={classNamesOf('size-4', accentClasses[intent])} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p className="text-sm font-semibold">{toast.title}</p>
        {toast.description ? (
          <p className="text-surface-fg-muted text-sm">{toast.description}</p>
        ) : null}
        {toast.action ? (
          <Link
            to={toast.action.to}
            onClick={dismiss}
            className={classNamesOf(textLinkClasses, 'w-fit text-sm')}
          >
            {toast.action.label}
          </Link>
        ) : null}
      </div>
      <span className="-my-2 -mr-2 flex">
        <IconButton label="Dismiss" icon={XIcon} tooltipSide="left" onClick={dismiss} />
      </span>
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
    aria-live="polite"
    aria-relevant="additions text"
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
  onNotify,
  children
}: {
  onNotify?: (toast: ToastInput) => void;
  children?: ReactNode;
}) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const record = useRef(onNotify);
  record.current = onNotify;
  const seq = useRef(0);
  const notify = useCallback<Notify>((toast) => {
    seq.current += 1;
    const id = seq.current;
    setToasts((list) => addToast(list, { ...toast, id }));
    if (toast.isRecorded !== false) record.current?.(toast);
  }, []);
  const dismiss = useCallback(
    (id: number) => setToasts((list) => list.filter((t) => t.id !== id)),
    []
  );
  return (
    <ToastContext value={notify}>
      {children}
      <Toaster toasts={toasts} onDismiss={dismiss} />
    </ToastContext>
  );
};
