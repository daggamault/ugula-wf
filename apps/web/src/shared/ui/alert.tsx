import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  type LucideIcon,
  TriangleAlertIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Tone } from './tone.ts';

export type AlertTone = Exclude<Tone, 'neutral'>;

const toneClasses: Readonly<Record<AlertTone, string>> = {
  info: 'border-primary/30 bg-primary/10 text-surface-fg',
  success: 'border-success/30 bg-success/10 text-surface-fg',
  warning: 'border-warning/30 bg-warning/10 text-warning-fg',
  danger: 'border-danger/30 bg-danger/10 text-danger'
};

const iconClasses: Readonly<Record<AlertTone, string>> = {
  info: 'text-primary',
  success: 'text-success',
  warning: '',
  danger: ''
};

const toneIcons: Readonly<Record<AlertTone, LucideIcon>> = {
  info: InfoIcon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon
};

export type AlertProps = {
  tone?: AlertTone;
  action?: ReactNode;
  children: ReactNode;
};

export const Alert = ({ tone = 'danger', action, children }: AlertProps) => {
  const Icon = toneIcons[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={classNamesOf(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        toneClasses[tone]
      )}
    >
      <Icon
        aria-hidden="true"
        className={classNamesOf('mt-0.5 size-4 shrink-0', iconClasses[tone])}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">{children}</div>
        {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
};
