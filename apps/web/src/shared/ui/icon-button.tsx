import type { LucideIcon } from 'lucide-react';
import { type ComponentProps, useId } from 'react';
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
  label: string;
  icon: LucideIcon;
  intent?: Extract<Intent, 'danger'>;
  tooltipSide?: TooltipSide;
  disabledReason?: string | undefined;
};

export const IconButton = ({
  label,
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
    <Tooltip label={disabledReason ?? label} side={tooltipSide}>
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
  label: string;
  icon: LucideIcon;
  tooltipSide?: TooltipSide;
};

export const IconLink = ({ to, label, icon: Icon, tooltipSide = 'bottom' }: IconLinkProps) => (
  <Tooltip label={label} side={tooltipSide}>
    <Link
      to={to}
      aria-label={label}
      className={classNamesOf(iconButtonClasses, neutralHoverClasses)}
    >
      <Icon aria-hidden="true" className="size-4.5" />
    </Link>
  </Tooltip>
);
