import type { ReactNode } from 'react';
import type { Intent } from './badge.tsx';

export type AlertProps = {
  intent?: Intent;
  children: ReactNode;
};

const intentClasses: Record<Intent, string> = {
  primary:
    'border-primary-500/30 bg-primary-100 text-primary-900 dark:bg-primary-900 dark:text-primary-100',
  success:
    'border-success-500/30 bg-success-50 text-success-700 dark:bg-success-950/50 dark:text-success-400',
  info: 'border-info-500/30 bg-info-50 text-info-700 dark:bg-info-950/50 dark:text-info-400',
  warning:
    'border-warning-500/30 bg-warning-50 text-warning-700 dark:bg-warning-950/50 dark:text-warning-400',
  danger:
    'border-danger-500/30 bg-danger-50 text-danger-700 dark:bg-danger-950/50 dark:text-danger-400'
};

export const Alert = ({ intent = 'info', children }: AlertProps) => (
  <p
    role="alert"
    className={`rounded-lg border px-3 py-2 text-sm transition-colors ${intentClasses[intent]}`}
  >
    {children}
  </p>
);
