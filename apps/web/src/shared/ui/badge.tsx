import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Tone } from './tone.ts';

const toneClasses: Readonly<Record<Tone, string>> = {
  neutral: 'bg-surface-fg/6 text-surface-fg-muted',
  info: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning-fg',
  danger: 'bg-danger/15 text-danger'
};

export type BadgeProps = {
  tone?: Tone;
  children: ReactNode;
};

export const Badge = ({ tone = 'info', children }: BadgeProps) => (
  <span
    className={classNamesOf(
      'inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 font-semibold text-xs',
      toneClasses[tone]
    )}
  >
    {children}
  </span>
);

export type StatusBadgeStyle = { label: string; tone: Tone };
