import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Intent } from './intent.ts';

const intentClasses: Readonly<Record<Intent, string>> = {
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  info: 'bg-info/15 text-info',
  warning: 'bg-warning/15 text-warning-fg',
  danger: 'bg-danger/15 text-danger'
};

export type BadgeProps = {
  intent?: Intent | undefined;
  children: ReactNode;
};

export const Badge = ({ intent, children }: BadgeProps) => (
  <span
    className={classNamesOf(
      'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold whitespace-nowrap',
      intent ? intentClasses[intent] : 'bg-surface-fg/6 text-surface-fg-muted'
    )}
  >
    {children}
  </span>
);

export type StatusBadgeStyle = { label: string; intent?: Intent };
