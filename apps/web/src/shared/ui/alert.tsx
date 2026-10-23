import {
  CircleAlertIcon,
  CircleCheckIcon,
  InfoIcon,
  type LucideIcon,
  TriangleAlertIcon
} from 'lucide-react';
import type { ReactNode } from 'react';
import { classNamesOf } from '../class-names.ts';
import type { Intent } from './intent.ts';

const intentClasses: Readonly<Record<Intent, string>> = {
  primary: 'border-primary/30 bg-primary/10',
  success: 'border-success/30 bg-success/10',
  info: 'border-info/30 bg-info/10',
  warning: 'border-warning/30 bg-warning/10 text-warning-fg',
  danger: 'border-danger/30 bg-danger/10 text-danger'
};

const iconClasses: Readonly<Record<Intent, string>> = {
  primary: 'text-primary',
  success: 'text-success',
  info: 'text-info',
  warning: '',
  danger: ''
};

const intentIcons: Readonly<Record<Intent, LucideIcon>> = {
  primary: InfoIcon,
  success: CircleCheckIcon,
  info: InfoIcon,
  warning: TriangleAlertIcon,
  danger: CircleAlertIcon
};

export type AlertProps = {
  intent?: Intent;
  action?: ReactNode;
  children: ReactNode;
};

export const Alert = ({ intent = 'danger', action, children }: AlertProps) => {
  const Icon = intentIcons[intent];
  return (
    <div
      role={intent === 'danger' ? 'alert' : 'status'}
      className={classNamesOf(
        'flex items-start gap-2.5 rounded-lg border px-3 py-2.5 text-sm',
        intentClasses[intent]
      )}
    >
      <Icon
        aria-hidden="true"
        className={classNamesOf('mt-0.5 size-4 shrink-0', iconClasses[intent])}
      />
      <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0">{children}</p>
        {action && <div className="flex shrink-0 flex-wrap gap-2">{action}</div>}
      </div>
    </div>
  );
};
