import { type LucideIcon, Trash2Icon, TriangleAlertIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Button } from './button.tsx';
import { IconButton } from './icon-button.tsx';
import type { Intent } from './intent.ts';

type DialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  isWide?: boolean;
  intent?: DialogIntent | undefined;
  onClose: () => void;
  children: ReactNode;
};

type DialogIntent = Extract<Intent, 'danger' | 'warning'>;

const intentClasses: Readonly<Record<DialogIntent, { dialog: string; icon: string }>> = {
  danger: { dialog: 'border-danger/30', icon: 'bg-danger/10 text-danger' },
  warning: { dialog: 'border-warning/30', icon: 'bg-warning/10 text-warning-fg' }
};

export const Dialog = ({
  open,
  title,
  description,
  isWide = false,
  intent,
  onClose,
  children
}: DialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);
  const isOpen = useRef(open);
  isOpen.current = open;
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={() => {
        if (isOpen.current) onClose();
      }}
      className={classNamesOf(
        'bg-surface text-surface-fg backdrop:bg-canvas/70 m-auto w-[calc(100%-2rem)] scale-95 rounded-xl border p-6 opacity-0 shadow-lg transition-[opacity,scale,display,overlay] transition-discrete duration-200 ease-out backdrop:opacity-0 backdrop:backdrop-blur-sm backdrop:transition-[opacity,display,overlay] backdrop:transition-discrete backdrop:duration-200 backdrop:ease-out open:scale-100 open:opacity-100 open:backdrop:opacity-100 starting:open:scale-95 starting:open:opacity-0 starting:open:backdrop:opacity-0',
        isWide ? 'max-w-2xl' : 'max-w-md',
        intent ? intentClasses[intent].dialog : 'border-border'
      )}
    >
      <div className="flex flex-col gap-6">
        <header className="flex items-start justify-between gap-4">
          {intent ? (
            <span
              aria-hidden="true"
              className={classNamesOf(
                'grid size-10 shrink-0 place-items-center rounded-full',
                intentClasses[intent].icon
              )}
            >
              <TriangleAlertIcon className="size-5" />
            </span>
          ) : null}
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <h2 id={titleId} className="text-base font-bold">
              {title}
            </h2>
            {description && <div className="text-surface-fg-muted text-sm">{description}</div>}
          </div>
          <div className="-my-1.5 -mr-2">
            <IconButton label="Close" icon={XIcon} onClick={() => ref.current?.close()} />
          </div>
        </header>
        {children}
      </div>
    </dialog>
  );
};

const DialogActions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap justify-end gap-2">{children}</div>
);

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  intent?: DialogIntent;
  confirmLabel: string;
  confirmIcon: LucideIcon;
  dismissLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
  children: ReactNode;
};

export const ConfirmDialog = ({
  open,
  title,
  intent,
  confirmLabel,
  confirmIcon: ConfirmIcon,
  dismissLabel = 'Cancel',
  onConfirm,
  onClose,
  children
}: ConfirmDialogProps) => (
  <Dialog open={open} title={title} intent={intent} description={children} onClose={onClose}>
    <DialogActions>
      <Button variant="outline" onClick={onClose}>
        <XIcon aria-hidden="true" className="size-4" />
        {dismissLabel}
      </Button>
      <Button intent={intent} onClick={onConfirm}>
        <ConfirmIcon aria-hidden="true" className="size-4" />
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);

type DeleteDialogProps = {
  open: boolean;
  name: string;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
};

export const DeleteDialog = ({ open, name, onConfirm, onClose, children }: DeleteDialogProps) => (
  <ConfirmDialog
    open={open}
    title={`Delete ${name}?`}
    intent="danger"
    confirmLabel="Delete"
    confirmIcon={Trash2Icon}
    dismissLabel="Keep"
    onConfirm={onConfirm}
    onClose={onClose}
  >
    <span className="flex flex-col gap-2">
      <span>
        Are you sure you want to delete <strong className="text-surface-fg">{name}</strong>? This
        cannot be undone.
      </span>
      {children ? <span>{children}</span> : null}
    </span>
  </ConfirmDialog>
);
