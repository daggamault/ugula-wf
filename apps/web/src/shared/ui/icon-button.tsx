import { ChevronRightIcon, type LucideIcon, PencilIcon, Trash2Icon } from 'lucide-react';
import { type ComponentProps, type ReactNode, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';
import type { Intent } from './intent.ts';
import { interactiveClasses } from './interactive.ts';
import { Tooltip, type TooltipSide } from './tooltip.tsx';

const iconButtonClasses = classNamesOf(
  'text-surface-fg-muted grid size-9 shrink-0 place-items-center rounded-lg not-aria-disabled:active:scale-[0.98] aria-disabled:opacity-50 pointer-coarse:size-11',
  interactiveClasses
);

const neutralHoverClasses =
  'not-aria-disabled:hover:bg-surface-fg/6 not-aria-disabled:hover:text-surface-fg';

const dangerHoverClasses =
  'not-aria-disabled:hover:bg-danger/10 not-aria-disabled:hover:text-danger';

type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'className' | 'disabled'> & {
  /** The accessible name; say which item it acts on ("Delete Medicare"). */
  label: string;
  /** A shorter visible tooltip ("Delete") when the row already says which item; defaults to the label. */
  tooltip?: string;
  icon: LucideIcon;
  intent?: Extract<Intent, 'danger'>;
  tooltipSide?: TooltipSide;
  disabledReason?: string | undefined;
};

export const IconButton = ({
  label,
  tooltip,
  icon: Icon,
  intent,
  tooltipSide = 'bottom',
  type = 'button',
  disabledReason,
  onClick,
  ...props
}: IconButtonProps) => {
  const reasonId = useId();
  const isEnabled = disabledReason === undefined;

  return (
    <Tooltip label={disabledReason ?? tooltip ?? label} side={tooltipSide}>
      <button
        type={type}
        aria-label={label}
        aria-disabled={!isEnabled || undefined}
        aria-describedby={isEnabled ? undefined : reasonId}
        className={classNamesOf(
          iconButtonClasses,
          intent === 'danger' ? dangerHoverClasses : neutralHoverClasses
        )}
        onClick={isEnabled ? onClick : preventDisabledClick}
        {...props}
      >
        <Icon aria-hidden="true" className="size-4.5" />
      </button>
      <DisabledReason id={reasonId} reason={disabledReason} />
    </Tooltip>
  );
};

type IconLinkProps = {
  to: string;
  rel?: string;
  /** The accessible name; say which item it opens ("Edit Medicare"). */
  label: string;
  /** A shorter visible tooltip ("Edit"); defaults to the label. */
  tooltip?: string;
  icon: LucideIcon;
  tooltipSide?: TooltipSide;
};

export const IconLink = ({
  to,
  rel,
  label,
  tooltip,
  icon: Icon,
  tooltipSide = 'bottom'
}: IconLinkProps) => (
  <Tooltip label={tooltip ?? label} side={tooltipSide}>
    <Link
      to={to}
      rel={rel}
      aria-label={label}
      className={classNamesOf(iconButtonClasses, neutralHoverClasses)}
    >
      <Icon aria-hidden="true" className="size-4.5" />
    </Link>
  </Tooltip>
);

/** The standard row actions. Tooltips stay short; accessible names say which row (WCAG 2.4.6). */
export const EditLink = ({ to, name }: { to: string; name: string }) => (
  <IconLink to={to} label={`Edit ${name}`} tooltip="Edit" icon={PencilIcon} />
);

export const OpenLink = ({ to, name }: { to: string; name: string }) => (
  <IconLink to={to} label={`Open ${name}`} tooltip="Open" icon={ChevronRightIcon} />
);

export const DeleteButton = ({ name, onClick }: { name: string; onClick: () => void }) => (
  <IconButton
    label={`Delete ${name}`}
    tooltip="Delete"
    icon={Trash2Icon}
    intent="danger"
    onClick={onClick}
  />
);

/** Row actions, right-aligned with even spacing. */
export const RowActions = ({ children }: { children: ReactNode }) => (
  <span className="flex items-center justify-end gap-1">{children}</span>
);
