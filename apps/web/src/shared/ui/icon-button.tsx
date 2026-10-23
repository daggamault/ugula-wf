import type { LucideIcon } from 'lucide-react';
import { type ComponentProps, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link } from '../router.tsx';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';
import { PendingOverlay } from './spinner.tsx';
import type { Tone } from './tone.ts';
import { Tooltip, type TooltipSide } from './tooltip.tsx';

const iconButtonClasses =
  'relative grid size-9 shrink-0 place-items-center pointer-coarse:size-11 rounded-lg text-surface-fg-muted not-aria-disabled:active:scale-[0.97] aria-disabled:not-aria-busy:opacity-50';

type IconButtonTone = Extract<Tone, 'neutral' | 'danger'>;

const toneClasses: Readonly<Record<IconButtonTone, string>> = {
  neutral: 'not-aria-disabled:hover:bg-surface-fg/6 not-aria-disabled:hover:text-surface-fg',
  danger: 'not-aria-disabled:hover:bg-danger/10 not-aria-disabled:hover:text-danger'
};

type IconButtonProps = Omit<ComponentProps<'button'>, 'children' | 'className' | 'disabled'> & {
  label: string;
  icon: LucideIcon;
  tone?: IconButtonTone;
  tooltipSide?: TooltipSide;
  isPending?: boolean;
  disabledReason?: string | undefined;
};

export const IconButton = ({
  label,
  icon: Icon,
  tone = 'neutral',
  tooltipSide = 'bottom',
  type = 'button',
  isPending = false,
  disabledReason,
  onClick,
  ...props
}: IconButtonProps) => {
  const reasonId = useId();
  const isEnabled = disabledReason === undefined && !isPending;

  return (
    <Tooltip label={disabledReason ?? label} side={tooltipSide}>
      <button
        type={type}
        aria-label={label}
        aria-busy={isPending || undefined}
        aria-disabled={!isEnabled || undefined}
        aria-describedby={disabledReason === undefined ? undefined : reasonId}
        className={classNamesOf(iconButtonClasses, toneClasses[tone])}
        onClick={isEnabled ? onClick : preventDisabledClick}
        {...props}
      >
        <Icon aria-hidden="true" className={classNamesOf('size-4.5', isPending && 'opacity-0')} />
        {isPending && <PendingOverlay />}
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
      className={classNamesOf(iconButtonClasses, toneClasses.neutral)}
    >
      <Icon aria-hidden="true" className="size-4.5" />
    </Link>
  </Tooltip>
);
