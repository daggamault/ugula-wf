import { type ComponentProps, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link, type LinkProps } from '../router.tsx';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';
import type { Intent } from './intent.ts';
import { interactiveClasses } from './interactive.ts';
import { PendingOverlay } from './spinner.tsx';
import { Tooltip, type TooltipSide } from './tooltip.tsx';

type ButtonVariant = 'solid' | 'outline';

type ButtonSize = 'md' | 'sm';

const solidClasses: Readonly<Record<Intent, string>> = {
  primary: 'bg-primary text-primary-fg not-aria-disabled:hover:brightness-110',
  success: 'bg-success text-canvas not-aria-disabled:hover:brightness-110',
  info: 'bg-info text-canvas not-aria-disabled:hover:brightness-110',
  warning: 'bg-warning text-on-warning not-aria-disabled:hover:brightness-105',
  danger: 'bg-danger text-canvas not-aria-disabled:hover:brightness-110'
};

const outlineClasses: Readonly<Record<Intent, string>> = {
  primary: 'border-border text-surface-fg not-aria-disabled:hover:border-surface-fg/25',
  success: 'border-success/40 text-success not-aria-disabled:hover:border-success/70',
  info: 'border-info/40 text-info not-aria-disabled:hover:border-info/70',
  warning: 'border-warning/60 text-warning-fg not-aria-disabled:hover:border-warning',
  danger: 'border-danger/40 text-danger not-aria-disabled:hover:border-danger/70'
};

const variantClasses: Readonly<Record<ButtonVariant, string>> = {
  solid: '',
  outline: 'bg-surface not-aria-disabled:hover:bg-surface-hover border'
};

const sizeClasses: Readonly<Record<ButtonSize, string>> = {
  md: 'h-10 px-4 pointer-coarse:h-11',
  sm: 'h-8 px-3 pointer-coarse:h-10'
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
    'relative inline-flex items-center justify-center gap-2 rounded-lg text-sm font-semibold whitespace-nowrap not-aria-disabled:active:scale-[0.98] aria-disabled:not-aria-busy:opacity-50',
    interactiveClasses,
    sizeClasses[size],
    variantClasses[variant],
    (variant === 'solid' ? solidClasses : outlineClasses)[intent]
  );

type ButtonProps = Omit<ComponentProps<'button'>, 'className' | 'disabled'> &
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
  'aria-describedby': describedBy,
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
      aria-describedby={
        [disabledReason === undefined ? null : reasonId, describedBy].filter(Boolean).join(' ') ||
        undefined
      }
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
