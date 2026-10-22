import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { Intent } from './badge.tsx';

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  intent?: Intent;
  children: ReactNode;
};

const intentClasses: Record<Intent, string> = {
  primary:
    'bg-primary-900 text-white hover:bg-primary-800 focus-visible:ring-primary-500 dark:bg-primary-100 dark:text-primary-950 dark:hover:bg-primary-200',
  success:
    'bg-success-600 text-white hover:bg-success-700 focus-visible:ring-success-500 dark:bg-success-500 dark:hover:bg-success-600',
  info: 'bg-info-600 text-white hover:bg-info-700 focus-visible:ring-info-500 dark:bg-info-500 dark:hover:bg-info-600',
  warning:
    'bg-warning-600 text-white hover:bg-warning-700 focus-visible:ring-warning-500 dark:bg-warning-500 dark:hover:bg-warning-600',
  danger:
    'bg-danger-600 text-white hover:bg-danger-700 focus-visible:ring-danger-500 dark:bg-danger-500 dark:hover:bg-danger-600'
};

export const Button = ({ intent = 'primary', type = 'button', children, ...rest }: ButtonProps) => (
  <button
    type={type}
    className={`inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-all duration-150 focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 dark:focus-visible:ring-offset-neutral-950 ${intentClasses[intent]}`}
    {...rest}
  >
    {children}
  </button>
);
