import type { ReactNode } from 'react';

export type Intent = 'primary' | 'success' | 'info' | 'warning' | 'danger';

export type BadgeProps = {
  intent?: Intent;
  children: ReactNode;
};

const intentClasses: Record<Intent, string> = {
  primary:
    'border-primary-500/20 bg-primary-100 text-primary-900 dark:bg-primary-900 dark:text-primary-100',
  success:
    'border-success-500/20 bg-success-50 text-success-600 dark:bg-success-950/50 dark:text-success-500',
  info: 'border-info-500/20 bg-info-50 text-info-700 dark:bg-info-950/50 dark:text-info-400',
  warning:
    'border-warning-500/20 bg-warning-50 text-warning-600 dark:bg-warning-950/50 dark:text-warning-500',
  danger:
    'border-danger-500/20 bg-danger-50 text-danger-600 dark:bg-danger-950/50 dark:text-danger-500'
};

export const Badge = ({ intent = 'primary', children }: BadgeProps) => (
  <span
    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-semibold transition-colors ${intentClasses[intent]}`}
  >
    {children}
  </span>
);
