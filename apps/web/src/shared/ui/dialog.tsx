import { type LucideIcon, XIcon } from 'lucide-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Button } from './button.tsx';
import { IconButton } from './icon-button.tsx';
import type { Tone } from './tone.ts';

export type DialogProps = {
  open: boolean;
  title: string;
  description?: ReactNode;
  isWide?: boolean;
  onClose: () => void;
  children: ReactNode;
};

export const Dialog = ({
  open,
  title,
  description,
  isWide = false,
  onClose,
  children
}: DialogProps) => {
  const ref = useRef<HTMLDialogElement>(null);
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
      onClose={onClose}
      className={classNamesOf(
        'm-auto w-[calc(100%-2rem)] scale-95 rounded-2xl border border-border bg-surface p-7 text-surface-fg opacity-0 shadow-2xl transition-[opacity,scale,display,overlay] transition-discrete duration-300 ease-out backdrop:bg-canvas/70 backdrop:opacity-0 backdrop:backdrop-blur-sm backdrop:transition-[opacity,display,overlay] backdrop:transition-discrete backdrop:duration-300 backdrop:ease-out open:scale-100 starting:open:scale-95 open:opacity-100 starting:open:opacity-0 open:backdrop:opacity-100 starting:open:backdrop:opacity-0',
        isWide ? 'max-w-2xl' : 'max-w-md'
      )}
    >
      <div className="flex flex-col gap-6">
        <header className="flex items-start justify-between gap-3">
          <div className="flex flex-col gap-2">
            <h2 id={titleId} className="text-lg font-bold tracking-tight">
              {title}
            </h2>
            {description && <div className="text-surface-fg-muted text-sm">{description}</div>}
          </div>
          <div className="-mt-1.5 -mr-3">
            <IconButton label="Close" icon={XIcon} onClick={onClose} />
          </div>
        </header>
        {children}
      </div>
    </dialog>
  );
};

export const DialogActions = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap justify-end gap-2">{children}</div>
);

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  tone?: Extract<Tone, 'danger' | 'warning'>;
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
  tone,
  confirmLabel,
  confirmIcon: ConfirmIcon,
  dismissLabel = 'Cancel',
  onConfirm,
  onClose,
  children
}: ConfirmDialogProps) => (
  <Dialog open={open} title={title} description={children} onClose={onClose}>
    <DialogActions>
      <Button variant="secondary" onClick={onClose}>
        <XIcon aria-hidden="true" className="size-4" />
        {dismissLabel}
      </Button>
      <Button variant={tone ?? 'primary'} onClick={onConfirm}>
        <ConfirmIcon aria-hidden="true" className="size-4" />
        {confirmLabel}
      </Button>
    </DialogActions>
  </Dialog>
);
