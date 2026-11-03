import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Intent } from './intent.ts';

const intentClasses: Readonly<Record<Intent, string>> = {
  primary: 'border-primary/30 bg-primary/10 text-primary',
  success: 'border-success/30 bg-success/10 text-success',
  info: 'border-info/30 bg-info/10 text-info',
  warning: 'border-warning/30 bg-warning/10 text-warning-fg',
  danger: 'border-danger/30 bg-danger/10 text-danger'
};

type BadgeProps = {
  intent?: Intent | undefined;
  children: ReactNode;
};

export const Badge = ({ intent, children }: BadgeProps) => (
  <span
    className={classNamesOf(
      'inline-flex items-center gap-1 rounded-full border px-2 text-xs/5 font-semibold whitespace-nowrap',
      intent ? intentClasses[intent] : 'border-border bg-surface-fg/6 text-surface-fg-muted'
    )}
  >
    {children}
  </span>
);

export type StatusBadgeStyle = { label: string; intent?: Intent };
