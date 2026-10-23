import { type ComponentProps, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link, type LinkProps } from '../router.tsx';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';
import type { Intent } from './intent.ts';
import { interactiveClasses } from './interactive.ts';
import { PendingOverlay } from './spinner.tsx';
import { Tooltip, type TooltipSide } from './tooltip.tsx';

export type ButtonVariant = 'solid' | 'outline';

type ButtonSize = 'md' | 'sm';

const solidClasses: Readonly<Record<Intent, string>> = {
  primary: 'bg-primary text-primary-fg not-aria-disabled:hover:brightness-110',
  success: 'bg-success text-canvas not-aria-disabled:hover:brightness-110',
  info: 'bg-info text-canvas not-aria-disabled:hover:brightness-110',
  warning:
    'border-warning/30 bg-warning/15 text-warning-fg not-aria-disabled:hover:bg-warning/25 border',
  danger: 'bg-danger text-canvas not-aria-disabled:hover:brightness-110'
};

const outlineClasses: Readonly<Record<Intent, string>> = {
  primary:
    'border-border bg-surface text-surface-fg not-aria-disabled:hover:bg-surface-fg/6 border',
  success: 'border-success/40 text-success not-aria-disabled:hover:bg-success/10 border',
  info: 'border-info/40 text-info not-aria-disabled:hover:bg-info/10 border',
  warning: 'border-warning/50 text-warning-fg not-aria-disabled:hover:bg-warning/10 border',
  danger: 'border-danger/40 text-danger not-aria-disabled:hover:bg-danger/10 border'
};

const sizeClasses: Readonly<Record<ButtonSize, string>> = {
  md: 'min-h-10 px-4 pointer-coarse:min-h-11',
  sm: 'min-h-8 px-3 pointer-coarse:min-h-10'
};

type ButtonStyle = {
  intent?: Intent | undefined;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
};

export const buttonClasses = ({
  intent = 'primary',
  variant = 'solid',
  size = 'md'
}: ButtonStyle = {}): string =>
  classNamesOf(
    'relative inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap not-aria-disabled:active:scale-[0.97] aria-disabled:not-aria-busy:opacity-50',
    interactiveClasses,
    sizeClasses[size],
    (variant === 'solid' ? solidClasses : outlineClasses)[intent]
  );

export type ButtonProps = Omit<ComponentProps<'button'>, 'className' | 'disabled'> &
  ButtonStyle & {
    isBlock?: boolean;
    isPending?: boolean;
    disabledReason?: string | undefined;
    tooltipSide?: TooltipSide;
  };

export const Button = ({
  type = 'button',
  intent,
  variant,
  size,
  isBlock = false,
  isPending = false,
  disabledReason,
  tooltipSide = 'bottom',
  onClick,
  children,
  ...props
}: ButtonProps) => {
  const reasonId = useId();
  const isEnabled = disabledReason === undefined && !isPending;
  const button = (
    <button
      type={type}
      aria-busy={isPending || undefined}
      aria-disabled={!isEnabled || undefined}
      aria-describedby={disabledReason === undefined ? undefined : reasonId}
      className={classNamesOf(buttonClasses({ intent, variant, size }), isBlock && 'w-full')}
      onClick={isEnabled ? onClick : preventDisabledClick}
      {...props}
    >
      <span className={classNamesOf('inline-flex items-center gap-2', isPending && 'opacity-0')}>
        {children}
      </span>
      {isPending && <PendingOverlay />}
    </button>
  );

  return disabledReason === undefined ? (
    button
  ) : (
    <Tooltip label={disabledReason} side={tooltipSide}>
      {button}
      <DisabledReason id={reasonId} reason={disabledReason} />
    </Tooltip>
  );
};

type ButtonLinkProps = Omit<LinkProps, 'className'> & ButtonStyle;

export const ButtonLink = ({ intent, variant, size, children, ...props }: ButtonLinkProps) => (
  <Link className={buttonClasses({ intent, variant, size })} {...props}>
    {children}
  </Link>
);
