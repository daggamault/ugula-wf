import { type ComponentProps, useId } from 'react';
import { classNamesOf } from '../class-names.ts';
import { Link, type LinkProps } from '../router.tsx';
import { DisabledReason, preventDisabledClick } from './disabled-reason.tsx';
import { PendingOverlay } from './spinner.tsx';
import { Tooltip, type TooltipSide } from './tooltip.tsx';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'warning';

type ButtonSize = 'md' | 'sm';

const variantClasses: Readonly<Record<ButtonVariant, string>> = {
  primary: 'bg-primary text-primary-fg not-aria-disabled:hover:brightness-110',
  secondary:
    'border border-border bg-surface text-surface-fg not-aria-disabled:hover:bg-surface-fg/6',
  danger: 'bg-danger text-canvas not-aria-disabled:hover:brightness-110',
  warning:
    'border border-warning/30 bg-warning/15 text-warning-fg not-aria-disabled:hover:bg-warning/25'
};

const sizeClasses: Readonly<Record<ButtonSize, string>> = {
  md: 'min-h-10 px-4 pointer-coarse:min-h-11',
  sm: 'min-h-8 px-3 pointer-coarse:min-h-10'
};

export const buttonClasses = (variant: ButtonVariant, size: ButtonSize = 'md'): string =>
  classNamesOf(
    'relative inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg font-semibold text-sm not-aria-disabled:active:scale-[0.97] aria-disabled:not-aria-busy:opacity-50',
    sizeClasses[size],
    variantClasses[variant]
  );

export type ButtonProps = Omit<ComponentProps<'button'>, 'className' | 'disabled'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isBlock?: boolean;
  isPending?: boolean;
  disabledReason?: string | undefined;
  tooltipSide?: TooltipSide;
};

export const Button = ({
  type = 'button',
  variant = 'primary',
  size = 'md',
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

  return (
    <Tooltip label={disabledReason} side={tooltipSide} isBlock={isBlock}>
      <button
        type={type}
        aria-busy={isPending || undefined}
        aria-disabled={!isEnabled || undefined}
        aria-describedby={disabledReason === undefined ? undefined : reasonId}
        className={classNamesOf(buttonClasses(variant, size), isBlock && 'w-full')}
        onClick={isEnabled ? onClick : preventDisabledClick}
        {...props}
      >
        <span className={classNamesOf('inline-flex items-center gap-2', isPending && 'opacity-0')}>
          {children}
        </span>
        {isPending && <PendingOverlay />}
      </button>
      <DisabledReason id={reasonId} reason={disabledReason} />
    </Tooltip>
  );
};

type ButtonLinkProps = Omit<LinkProps, 'className'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
};

export const ButtonLink = ({
  variant = 'primary',
  size = 'md',
  children,
  ...props
}: ButtonLinkProps) => (
  <Link className={buttonClasses(variant, size)} {...props}>
    {children}
  </Link>
);
